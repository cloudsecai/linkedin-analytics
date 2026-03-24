const SERVER_URL = "http://localhost:3210";

const lastSyncEl = document.getElementById("last-sync")!;
const postsStatusEl = document.getElementById("posts-status")!;
const followersStatusEl = document.getElementById("followers-status")!;
const profileStatusEl = document.getElementById("profile-status")!;
const alertEl = document.getElementById("alert")!;
const syncBtn = document.getElementById("sync-btn") as HTMLButtonElement;
const dashboardBtn = document.getElementById("dashboard-btn") as HTMLButtonElement;

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function setSourceStatus(
  el: HTMLElement,
  status: "ok" | "error" | null
) {
  if (status === "ok") {
    el.textContent = "OK";
    el.className = "status-value status-ok";
  } else if (status === "error") {
    el.textContent = "Error";
    el.className = "status-value status-error";
  } else {
    el.textContent = "--";
    el.className = "status-value status-pending";
  }
}

async function loadStatus() {
  // Get sync status from service worker
  chrome.runtime.sendMessage(
    { type: "get-sync-status" },
    (response) => {
      if (response?.lastSyncAt) {
        lastSyncEl.textContent = formatTimeAgo(response.lastSyncAt);
      }
      if (response?.syncInProgress) {
        syncBtn.textContent = response.syncProgress ?? "Syncing...";
        syncBtn.disabled = true;
      }
    }
  );

  // Get health from server
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    if (!res.ok) throw new Error("Server error");
    const health = await res.json();

    setSourceStatus(postsStatusEl, health.sources?.posts?.status ?? null);
    setSourceStatus(followersStatusEl, health.sources?.followers?.status ?? null);
    setSourceStatus(profileStatusEl, health.sources?.profile?.status ?? null);

    // Show alert if any source has errors
    const errors: string[] = [];
    for (const [name, source] of Object.entries(health.sources ?? {}) as any) {
      if (source.status === "error") {
        errors.push(`${name}: ${source.error || "check failed"}`);
      }
    }
    if (errors.length > 0) {
      alertEl.textContent = errors.join("; ");
      alertEl.style.display = "block";
    }
  } catch {
    // Server not running
    alertEl.textContent = "Server not running. Start with: npm start";
    alertEl.style.display = "block";
  }
}

syncBtn.addEventListener("click", () => {
  syncBtn.textContent = "Syncing...";
  syncBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "trigger-sync" }, () => {
    setTimeout(() => {
      syncBtn.textContent = "Sync Now";
      syncBtn.disabled = false;
      loadStatus();
    }, 3000);
  });
});

dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: `${SERVER_URL}` });
});

loadStatus();
