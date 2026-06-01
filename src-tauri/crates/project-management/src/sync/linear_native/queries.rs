pub(super) const PROJECTS_QUERY: &str = r#"
query OrgiiLinearProjects($cursor: String) {
  projects(first: 50, after: $cursor, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      description
      status { id name type color }
      slugId
      url
      icon
      color
      startDate
      targetDate
      createdAt
      updatedAt
      archivedAt
      lead { id name email }
      teams { nodes { id name key } }
    }
  }
}
"#;

pub(super) const PROJECT_QUERY: &str = r#"
query OrgiiLinearProject($id: String!) {
  project(id: $id) {
    id
    name
    description
    status { id name type color }
    slugId
    url
    icon
    color
    startDate
    targetDate
    createdAt
    updatedAt
    archivedAt
    lead { id name email }
    teams { nodes { id name key } }
  }
}
"#;

pub(super) const TEAMS_QUERY: &str = r#"
query OrgiiLinearTeams($cursor: String) {
  teams(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id name key }
  }
}
"#;

pub(super) const TEAM_WORKFLOW_STATES_QUERY: &str = r#"
query OrgiiLinearTeamWorkflowStates($teamId: String!) {
  team(id: $teamId) {
    id
    name
    key
    states(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        description
        type
        color
        position
        archivedAt
        team { id name key }
      }
    }
  }
}
"#;

pub(super) const WORKFLOW_STATE_CREATE_MUTATION: &str = r#"
mutation OrgiiLinearWorkflowStateCreate($input: WorkflowStateCreateInput!) {
  workflowStateCreate(input: $input) {
    success
    workflowState {
      id
      name
      description
      type
      color
      position
      archivedAt
      team { id name key }
    }
  }
}
"#;

pub(super) const WORKFLOW_STATE_UPDATE_MUTATION: &str = r#"
mutation OrgiiLinearWorkflowStateUpdate($id: String!, $input: WorkflowStateUpdateInput!) {
  workflowStateUpdate(id: $id, input: $input) {
    success
    workflowState {
      id
      name
      description
      type
      color
      position
      archivedAt
      team { id name key }
    }
  }
}
"#;

pub(super) const WORKFLOW_STATE_ARCHIVE_MUTATION: &str = r#"
mutation OrgiiLinearWorkflowStateArchive($id: String!) {
  workflowStateArchive(id: $id) {
    success
    entity {
      id
      name
      description
      type
      color
      position
      archivedAt
      team { id name key }
    }
  }
}
"#;

pub(super) const PROJECT_ISSUES_QUERY: &str = r#"
query OrgiiLinearProjectIssues($projectId: ID!, $cursor: String) {
  issues(
    first: 50
    after: $cursor
    filter: { project: { id: { eq: $projectId } } }
    orderBy: updatedAt
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      title
      description
      priority
      estimate
      url
      createdAt
      updatedAt
      archivedAt
      state { id name type }
      assignee { id name email }
      project { id name }
      team { id name key }
      labels { nodes { id name color } }
    }
  }
}
"#;

pub(super) const PROJECT_CREATE_MUTATION: &str = r#"
mutation OrgiiLinearProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    success
    project {
      id
      name
      description
      status { id name type color }
      slugId
      url
      icon
      color
      startDate
      targetDate
      createdAt
      updatedAt
      archivedAt
      lead { id name email }
      teams { nodes { id name key } }
    }
  }
}
"#;

pub(super) const PROJECT_UPDATE_MUTATION: &str = r#"
mutation OrgiiLinearProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) {
    success
    project {
      id
      name
      description
      status { id name type color }
      slugId
      url
      icon
      color
      startDate
      targetDate
      createdAt
      updatedAt
      archivedAt
      lead { id name email }
      teams { nodes { id name key } }
    }
  }
}
"#;

pub(super) const PROJECT_ARCHIVE_MUTATION: &str = r#"
mutation OrgiiLinearProjectArchive($id: String!) {
  projectArchive(id: $id) { success }
}
"#;

pub(super) const ISSUE_CREATE_MUTATION: &str = r#"
mutation OrgiiLinearIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      description
      priority
      estimate
      url
      createdAt
      updatedAt
      archivedAt
      state { id name type }
      assignee { id name email }
      project { id name }
      team { id name key }
      labels { nodes { id name color } }
    }
  }
}
"#;

pub(super) const ISSUE_UPDATE_MUTATION: &str = r#"
mutation OrgiiLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue {
      id
      identifier
      title
      description
      priority
      estimate
      url
      createdAt
      updatedAt
      archivedAt
      state { id name type }
      assignee { id name email }
      project { id name }
      team { id name key }
      labels { nodes { id name color } }
    }
  }
}
"#;

pub(super) const ISSUE_ARCHIVE_MUTATION: &str = r#"
mutation OrgiiLinearIssueArchive($id: String!) {
  issueArchive(id: $id) { success }
}
"#;
