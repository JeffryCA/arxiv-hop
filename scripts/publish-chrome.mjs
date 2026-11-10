import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const { CWS_PUBLISHER_ID: publisher, CWS_ITEM_ID: item, CWS_ACCESS_TOKEN: token } = process.env;
if (!publisher || !/^[a-p]{32}$/.test(item ?? "") || !token) {
  throw new Error("Chrome Web Store publisher ID, item ID, and access token are required.");
}

const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
const api = "https://chromewebstore.googleapis.com";
const resource = `/v2/publishers/${encodeURIComponent(publisher)}/items/${item}`;

async function request(path, options = {}) {
  const response = await fetch(api + path, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Chrome Web Store API ${response.status}: ${result.error?.message || response.statusText}`);
  }
  return result;
}

const status = await request(`${resource}:fetchStatus`);
const published = status.publishedItemRevisionStatus;
const submitted = status.submittedItemRevisionStatus;
const includesVersion = revision => revision?.distributionChannels?.some(channel => channel.crxVersion === version);

if (status.takenDown || status.warned) {
  throw new Error("Check the policy status in the Chrome Web Store dashboard.");
}
if (includesVersion(published) || (submitted?.state === "PENDING_REVIEW" && includesVersion(submitted))) {
  console.log(`Version ${version} is already published or awaiting review.`);
  process.exit(0);
}
if (["PENDING_REVIEW", "STAGED"].includes(submitted?.state) || status.lastAsyncUploadState === "IN_PROGRESS") {
  throw new Error("Another Store upload or submission is active. Check its status before rerunning.");
}

const upload = await request(`/upload${resource}:upload`, {
  method: "POST",
  headers: { "Content-Type": "application/zip" },
  body: await readFile("dist/arxiv-hop-chrome.zip")
});
let uploadState = upload.uploadState;
for (let attempt = 0; uploadState === "IN_PROGRESS" && attempt < 24; attempt++) {
  await delay(5000);
  const current = await request(`${resource}:fetchStatus`);
  uploadState = current.lastAsyncUploadState;
}
if (uploadState !== "SUCCEEDED" || (upload.crxVersion && upload.crxVersion !== version)) {
  throw new Error(`Chrome Web Store upload did not confirm version ${version}. Upload state: ${uploadState}.`);
}

const submission = await request(`${resource}:publish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" })
});
if (!["PENDING_REVIEW", "PUBLISHED", "PUBLISHED_TO_TESTERS"].includes(submission.state)) {
  throw new Error(`Unexpected submission state: ${submission.state}. Check the Store dashboard.`);
}
console.log(`Chrome Web Store version ${version}: ${submission.state}.`);
