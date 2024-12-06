import { authenticate } from "@google-cloud/local-auth";
import fs from "fs/promises";
import { OAuth2Client } from "google-auth-library";
import { google, tasks_v1 } from "googleapis";
import path from "path";

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/tasks"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content.toString());
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client: OAuth2Client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content.toString());
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
export async function authorize() {
  let client = await loadSavedCredentialsIfExist();

  if (client) {
    return client;
  }

  const oauth2Client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  if (oauth2Client.credentials) {
    await saveCredentials(oauth2Client);
  }

  return oauth2Client;
}

/**
 * Lists the user's first 10 task lists.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function getTaskList(service: tasks_v1.Tasks) {
  const res = await service.tasklists.list({
    maxResults: 10,
  });

  const taskLists = res.data.items;

  return taskLists?.at(0) ?? null;
}

async function getTasksForList(
  service: tasks_v1.Tasks,
  list: tasks_v1.Schema$TaskList
) {
  if (!list.id) {
    throw new Error("List ID is required to get tasks.");
  }

  const res = await service.tasks.list({
    tasklist: list.id,
  });

  const tasks = res.data.items;

  const taskMap = new Map<string, boolean>();

  if (tasks && tasks.length > 0) {
    console.log("Tasks:");
    tasks
      .filter((task) => task.title)
      .forEach((task) => {
        const title = task.title ?? "Unknown";
        const isDone = task.status === "completed";
        taskMap.set(title, isDone);
      });
  }

  return taskMap;
}

async function markTaskAsDone(service: tasks_v1.Tasks, title: string) {
  const list = await getTaskList(service);

  if (!list) {
    throw new Error("No task list found.");
  }

  if (!list.id) {
    throw new Error("List ID is required to get tasks.");
  }

  const res = await service.tasks.list({
    tasklist: list.id,
  });

  const tasks = res.data.items;

  if (!tasks) {
    throw new Error("No tasks found.");
  }

  const task = tasks.find((task) => task.title === title);

  if (!task) {
    throw new Error(`No task found with title: ${title}`);
  }

  if (!task.id) {
    throw new Error(`No task ID found for task with title: ${title}`);
  }

  await service.tasks.update({
    tasklist: list.id,
    task: task.id,
    requestBody: {
      ...task,
      status: "completed",
    },
  });
}

function getTaskService(auth) {
  return google.tasks({ version: "v1", auth });
}

export async function getTasks() {
  const service = getTaskService(await authorize());
  const list = await getTaskList(service);
  if (!list) {
    throw new Error("No task list found.");
  }
  return getTasksForList(service, list);
}

export async function markTaskAsDoneByTitle(title: string) {
  const service = getTaskService(await authorize());
  return markTaskAsDone(service, title);
}
