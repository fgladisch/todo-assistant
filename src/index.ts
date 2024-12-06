import { AIMessage, BaseMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StructuredTool, tool } from "@langchain/core/tools";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const GPT_MODEL_ID = "gpt-4o";
const MODEL_TEMPERATURE = 0;
const MODEL_MAX_TOKENS = 256;

const SYSTEM_INSTRUCTION = `You are an helpful assistant, who manages a todo list for the user.

You can add todos to the list, get the list of todos, and mark todos as done.

Check if a todo exists in the list, before adding it or marking it as done.

Always get the list of todos before giving a response, because other systems might have changed the list.

At the start of the conversation, get the list of todos.

Always read, write and think in german.`;

const todos = new Map<string, boolean>();

export const GET_TODOS_TOOL: StructuredTool = tool(
  async () => {
    const entries = Array.from(todos.entries());
    return JSON.stringify(
      entries.map(([title, isDone]) => ({ title, isDone })),
      null
    );
  },
  {
    name: "get_todos",
    description: "Gets the todos from the user's todo list.",
    schema: z.object({}),
  }
);

export const ADD_TODO_TOOL: StructuredTool = tool(
  async ({ title }) => todos.set(title, false),
  {
    name: "add_todo",
    description: "Adds a todo to the user's todo list.",
    schema: z.object({
      title: z.string().describe("The title of the todo."),
    }),
  }
);

export const MARK_TODO_AS_DONE_TOOL: StructuredTool = tool(
  async ({ title }) => todos.set(title, true),
  {
    name: "mark_todo_as_done",
    description: "Marks a todo as done in the user's todo list.",
    schema: z.object({
      title: z.string().describe("The title of the todo."),
    }),
  }
);

const TOOLKIT = [GET_TODOS_TOOL, ADD_TODO_TOOL, MARK_TODO_AS_DONE_TOOL];

async function isToolCall(
  state: typeof MessagesAnnotation.State
): Promise<string> {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls && lastMessage.tool_calls?.length > 0) {
    return "tools";
  }

  return END;
}

async function callModel(
  state: typeof MessagesAnnotation.State
): Promise<typeof MessagesAnnotation.State> {
  const model = new ChatOpenAI({
    model: GPT_MODEL_ID,
    temperature: MODEL_TEMPERATURE,
    maxTokens: MODEL_MAX_TOKENS,
  });

  const response = await ChatPromptTemplate.fromMessages<{
    history: BaseMessage[];
  }>([["system", SYSTEM_INSTRUCTION], new MessagesPlaceholder("history")])
    .pipe(model.bindTools(TOOLKIT))
    .invoke({
      history: state.messages,
    });

  return { messages: [response] };
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("assistant", callModel)
  .addNode("tools", new ToolNode(TOOLKIT))
  .addEdge(START, "assistant")
  .addConditionalEdges("assistant", isToolCall, ["tools", END])
  .addEdge("tools", "assistant");

export const graph = workflow.compile();
