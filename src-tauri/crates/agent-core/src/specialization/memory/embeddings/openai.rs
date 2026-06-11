//! OpenAI-compatible embedding provider.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{EmbeddingProvider, EmbeddingResult, OPENAI_DEFAULT_DIMS};

const OPENAI_DEFAULT_MODEL: &str = "text-embedding-3-small";
const OPENAI_DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

/// OpenAI-compatible embedding provider.
pub struct OpenAIEmbeddingProvider {
    api_key: String,
    model: String,
    base_url: String,
    dimensions: usize,
    client: reqwest::Client,
}

impl OpenAIEmbeddingProvider {
    pub fn new(api_key: String, model: Option<String>, base_url: Option<String>) -> Self {
        Self {
            api_key,
            model: model.unwrap_or_else(|| OPENAI_DEFAULT_MODEL.to_string()),
            base_url: base_url.unwrap_or_else(|| OPENAI_DEFAULT_BASE_URL.to_string()),
            dimensions: OPENAI_DEFAULT_DIMS,
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Serialize)]
pub(crate) struct OpenAIEmbedRequest {
    pub input: Vec<String>,
    pub model: String,
}

#[derive(Deserialize)]
pub(crate) struct OpenAIEmbedResponse {
    pub data: Vec<OpenAIEmbedData>,
}

#[derive(Deserialize)]
pub(crate) struct OpenAIEmbedData {
    pub embedding: Vec<f32>,
}

#[async_trait]
impl EmbeddingProvider for OpenAIEmbeddingProvider {
    async fn embed(&self, text: &str) -> Result<EmbeddingResult, String> {
        let url = format!("{}/embeddings", self.base_url);

        let request = OpenAIEmbedRequest {
            input: vec![text.to_string()],
            model: self.model.clone(),
        };

        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|err| format!("OpenAI embedding request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = crate::utils::response_text_or_read_error(response).await;
            return Err(format!(
                "OpenAI embedding API returned {}: {}",
                status, body
            ));
        }

        let body: OpenAIEmbedResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse OpenAI embedding response: {}", err))?;

        let embedding = body
            .data
            .into_iter()
            .next()
            .ok_or_else(|| "Empty embedding response".to_string())?;

        Ok(EmbeddingResult {
            dimensions: embedding.embedding.len(),
            vector: embedding.embedding,
            model: self.model.clone(),
        })
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<EmbeddingResult>, String> {
        let url = format!("{}/embeddings", self.base_url);

        let request = OpenAIEmbedRequest {
            input: texts.to_vec(),
            model: self.model.clone(),
        };

        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|err| format!("OpenAI batch embedding request failed: {}", err))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = crate::utils::response_text_or_read_error(response).await;
            return Err(format!(
                "OpenAI embedding API returned {}: {}",
                status, body
            ));
        }

        let body: OpenAIEmbedResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse batch embedding response: {}", err))?;

        Ok(body
            .data
            .into_iter()
            .map(|item| EmbeddingResult {
                dimensions: item.embedding.len(),
                vector: item.embedding,
                model: self.model.clone(),
            })
            .collect())
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn provider_name(&self) -> &str {
        "openai"
    }
}
