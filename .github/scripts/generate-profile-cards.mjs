import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;

if (!username) {
  throw new Error("PROFILE_USERNAME or GITHUB_REPOSITORY_OWNER is required.");
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "profile-card-generator",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

async function getOwnedRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }

  return repositories.filter((repo) => !repo.fork && !repo.archived);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderStats({ repositoryCount, activeCount, languageCount, memberSince, generatedAt }) {
  const metrics = [
    [String(repositoryCount).padStart(2, "0"), "PUBLIC REPOS"],
    [String(activeCount).padStart(2, "0"), "ACTIVE / 30D"],
    [String(languageCount).padStart(2, "0"), "LANGUAGES"],
    [String(memberSince), "GITHUB SINCE"],
  ];

  const metricMarkup = metrics
    .map(([value, label], index) => {
      const x = 28 + index * 108;
      return `
      <g transform="translate(${x} 70)">
        <rect width="98" height="66" rx="9" fill="#121D2D" stroke="#2F3C50" />
        <text x="12" y="31" fill="#F0EBE1" font-size="27" font-weight="720">${escapeXml(value)}</text>
        <text x="12" y="51" fill="#8795A8" font-size="8.5" font-weight="700" letter-spacing="1">${escapeXml(label)}</text>
      </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="180" viewBox="0 0 495 180" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} public GitHub activity</title>
  <desc id="desc">${repositoryCount} public repositories, ${activeCount} active in the last 30 days, and ${languageCount} detected languages.</desc>
  <rect x="1" y="1" width="493" height="178" rx="14" fill="#0D1422" stroke="#354155" />
  <rect x="27" y="24" width="7" height="24" rx="2" fill="#A88F71" />
  <text x="48" y="42" fill="#D7DCE5" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="17" font-weight="700">Engineering pulse</text>
  <text x="466" y="40" text-anchor="end" fill="#69788C" font-family="ui-monospace, monospace" font-size="8.5">UPDATED ${escapeXml(generatedAt)}</text>
  <g font-family="Inter, ui-sans-serif, system-ui, sans-serif">${metricMarkup}
  </g>
  <path d="M28 154 H467" stroke="#354155" stroke-width="1" />
  <text x="28" y="169" fill="#6F7D90" font-family="ui-sans-serif, system-ui, sans-serif" font-size="8.5" letter-spacing="0.8">PUBLIC, NON-FORK, NON-ARCHIVED REPOSITORIES</text>
</svg>`;
}

function renderLanguages(languages, generatedAt) {
  const palette = ["#6F879E", "#8B7C91", "#A98C6D", "#6E897F", "#7D7896"];
  const top = languages.slice(0, 5);
  const maxPercent = top[0]?.percent || 1;

  const rows = top
    .map(({ name, percent }, index) => {
      const y = 60 + index * 22;
      const width = Math.max(5, Math.round((percent / maxPercent) * 102));
      return `
    <text x="24" y="${y + 9}" fill="#B8C1CE" font-size="9.5" font-weight="650">${escapeXml(name)}</text>
    <rect x="112" y="${y}" width="112" height="10" rx="3" fill="#192435" />
    <rect x="112" y="${y}" width="${width}" height="10" rx="3" fill="${palette[index]}" />
    <text x="302" y="${y + 9}" text-anchor="end" fill="#8795A8" font-family="ui-monospace, monospace" font-size="8.5">${percent.toFixed(1)}%</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="180" viewBox="0 0 330 180" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} public repository language composition</title>
  <desc id="desc">Top languages by GitHub-reported bytes across public owned repositories.</desc>
  <rect x="1" y="1" width="328" height="178" rx="14" fill="#0D1422" stroke="#354155" />
  <text x="24" y="35" fill="#D7DCE5" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="17" font-weight="700">Repository mix</text>
  <text x="303" y="34" text-anchor="end" fill="#69788C" font-family="ui-monospace, monospace" font-size="8">${escapeXml(generatedAt)}</text>
  <g font-family="Inter, ui-sans-serif, system-ui, sans-serif">${rows}
  </g>
  <text x="24" y="171" fill="#667589" font-family="ui-sans-serif, system-ui, sans-serif" font-size="8">BY GITHUB-REPORTED BYTES · NOT A SKILL RANKING</text>
</svg>`;
}

async function main() {
  const [profile, repositories] = await Promise.all([
    github(`/users/${encodeURIComponent(username)}`),
    getOwnedRepositories(),
  ]);

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeCount = repositories.filter((repo) => new Date(repo.pushed_at).getTime() >= cutoff).length;

  const languageMaps = await Promise.all(
    repositories.map((repo) => github(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/languages`)),
  );

  const totals = new Map();
  for (const languageMap of languageMaps) {
    for (const [language, bytes] of Object.entries(languageMap)) {
      totals.set(language, (totals.get(language) || 0) + Number(bytes));
    }
  }

  const totalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0) || 1;
  const languages = [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes, percent: (bytes / totalBytes) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);

  const generatedAt = new Date().toISOString().slice(0, 10);
  const memberSince = new Date(profile.created_at).getUTCFullYear();

  await mkdir("assets", { recursive: true });
  await Promise.all([
    writeFile(
      "assets/stats.svg",
      renderStats({
        repositoryCount: repositories.length,
        activeCount,
        languageCount: languages.length,
        memberSince,
        generatedAt,
      }),
      "utf8",
    ),
    writeFile("assets/top-langs.svg", renderLanguages(languages, generatedAt), "utf8"),
  ]);

  console.log(`Generated profile cards for ${username}: ${repositories.length} repositories, ${languages.length} languages.`);
}

await main();

