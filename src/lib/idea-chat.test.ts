import { describe, it, expect } from "vitest";
import { buildChatPrompt, chatTurn, conversationMarkdown, discussionNotes, type ChatMessage } from "./idea-chat";

// C: a conversation before the phases (and on a phase document), with the person's own model.

const KEY = "sk" + "-proj-" + "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zAbCdEfGh";
const talk: ChatMessage[] = [
  { role: "person", text: "An app that reminds families to buy groceries" },
  { role: "assistant", text: "Who shops: one person or the whole family?" },
  { role: "person", text: "The whole family, on their phones" },
];

describe("buildChatPrompt", () => {
  it("sends the whole conversation, the instructions and the understand-intent skill when given", () => {
    const prompt = buildChatPrompt({ kind: "idea", messages: talk, skill: "UNDERSTAND METHOD" });
    expect(prompt).toContain("An app that reminds families");
    expect(prompt).toContain("The whole family, on their phones");
    expect(prompt).toContain("UNDERSTAND METHOD");
    expect(prompt).toMatch(/READY:/);
  });

  it("for a phase document, includes the document the person is discussing", () => {
    const prompt = buildChatPrompt({ kind: "document", phase: "prd", document: "# PRD\n\nOpen question: pricing?", messages: talk });
    expect(prompt).toContain("Open question: pricing?");
    expect(prompt).toContain("prd");
  });
});

describe("chatTurn", () => {
  it("returns the model's reply and notices when it says it has understood", async () => {
    const invoke = async () => ({ text: "You want a shared family list.\nREADY: A shared grocery list for families", provider: "made-up", model: "made-up-model" });
    const turn = await chatTurn(invoke, {}, { kind: "idea", messages: talk });
    expect(turn).toEqual({ ok: true, reply: "You want a shared family list.", ready: "A shared grocery list for families" });
  });

  it("is not ready when the reply has no READY line", async () => {
    const invoke = async () => ({ text: "How often do they shop?", provider: "made-up", model: "m" });
    expect(await chatTurn(invoke, {}, { kind: "idea", messages: talk })).toEqual({ ok: true, reply: "How often do they shop?", ready: null });
  });

  it("passes the model's real error on instead of inventing a reply", async () => {
    const invoke = async () => Promise.reject("made-up provider: rate limit reached");
    expect(await chatTurn(invoke, {}, { kind: "idea", messages: talk })).toEqual({ ok: false, error: "made-up provider: rate limit reached" });
  });
});

describe("conversationMarkdown", () => {
  it("writes the conversation for the project, with any key removed (MEM-6)", () => {
    const text = conversationMarkdown("Grocery list", [...talk, { role: "person", text: `my key is ${KEY}` }], "A shared grocery list for families");
    expect(text).toMatch(/^# Grocery list: the idea/);
    expect(text).toContain("A shared grocery list for families");
    expect(text).toContain("**You:** The whole family, on their phones");
    expect(text).toContain("**AI:** Who shops");
    expect(text).not.toContain(KEY);
  });
});

describe("discussionNotes", () => {
  it("turns a discussion on a document into change notes for the revision", () => {
    const notes = discussionNotes(talk);
    expect(notes).toMatch(/Revise the document using this conversation/);
    expect(notes).toContain("You: The whole family, on their phones");
    expect(notes).toContain("AI: Who shops");
  });
});
