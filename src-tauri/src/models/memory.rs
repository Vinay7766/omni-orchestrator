//! Rust types for the project-memory files the desktop app reads and writes.
//! The contract is /schemas (shared with the TypeScript core); tests/memory_contract_tests.rs
//! checks these types against every schema fixture so the two sides cannot drift.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Flow {
    Build,
    Pitch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Full,
    Simple,
}

/// `.agents/project.json`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub mode: Mode,
    pub flow: Flow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhaseStatus {
    NotStarted,
    InProgress,
    AwaitingReview,
    ChangesRequested,
    Approved,
    /// An optional phase a person declined (C15, SEC-1).
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseState {
    pub status: PhaseStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    Designed,
    InProgress,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trivial_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assigned_tool: Option<String>,
}

/// `.agents/state.json`: a snapshot rebuilt from the event log, never the source of truth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub format_version: u32,
    pub flow: Flow,
    pub current_phase: Option<String>,
    pub phases: BTreeMap<String, PhaseState>,
    pub tasks: Vec<Task>,
    pub last_event_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ActorKind {
    Agent,
    Human,
}

/// Who caused an event. Tool and model are free text: there is no fixed tool list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Actor {
    pub kind: ActorKind,
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    ProjectCreated,
    /// A person changed the project's name or mode (E3, APP-2).
    ProjectUpdated,
    ToolsSelected,
    PhaseStarted,
    PhaseSubmitted,
    PhaseApproved,
    PhaseSkipped,
    ChangesRequested,
    TaskCreated,
    DesignNoteSubmitted,
    TaskMarkedTrivial,
    TaskStarted,
    TaskCompleted,
    TaskReopened,
    DecisionRecorded,
    ProblemRecorded,
    LessonRecorded,
    MemoryUpdated,
}

impl EventType {
    /// Every variant, so tests can compare this enum with the schema's list.
    pub const ALL: [EventType; 18] = [
        EventType::ProjectCreated,
        EventType::ProjectUpdated,
        EventType::ToolsSelected,
        EventType::PhaseStarted,
        EventType::PhaseSubmitted,
        EventType::PhaseApproved,
        EventType::PhaseSkipped,
        EventType::ChangesRequested,
        EventType::TaskCreated,
        EventType::DesignNoteSubmitted,
        EventType::TaskMarkedTrivial,
        EventType::TaskStarted,
        EventType::TaskCompleted,
        EventType::TaskReopened,
        EventType::DecisionRecorded,
        EventType::ProblemRecorded,
        EventType::LessonRecorded,
        EventType::MemoryUpdated,
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct Refs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commits: Option<Vec<String>>,
}

/// One line of `.agents/events.jsonl`. The payload's shape depends on the event type
/// and is validated against the schema before it is written.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub format_version: u32,
    pub id: String,
    pub time: String,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub actor: Actor,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refs: Option<Refs>,
}
