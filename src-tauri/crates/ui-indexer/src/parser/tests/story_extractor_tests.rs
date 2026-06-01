use super::*;

#[test]
fn test_is_story_file() {
    assert!(StoryExtractor::is_story_file(Path::new("Button.orgii.tsx")));
    assert!(StoryExtractor::is_story_file(Path::new("Button.orgii.ts")));
    assert!(!StoryExtractor::is_story_file(Path::new("Button.tsx")));
    assert!(!StoryExtractor::is_story_file(Path::new(
        "Button.stories.tsx"
    )));
}

#[test]
fn test_extract_simple_story() {
    let mut extractor = StoryExtractor::new().unwrap();

    let content = r#"
import Button from "./index";

export default {
  component: Button,
  title: "Components/Button",
};

export const Primary = {
  args: {
    type: "primary",
    children: "Click me",
  },
  description: "Primary button",
};
"#;

    let result = extractor.extract_stories(Path::new("Button.orgii.tsx"), content);
    assert!(result.is_ok(), "extract_stories failed: {:?}", result.err());

    let info = result.unwrap();
    assert_eq!(info.meta.title, "Components/Button");
    assert_eq!(info.stories.len(), 1);
    assert_eq!(info.stories[0].export_name, "Primary");
    assert_eq!(
        info.stories[0].description,
        Some("Primary button".to_string())
    );
}
