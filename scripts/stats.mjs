#!/usr/bin/env node
// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
/**
 * Prints this app's usage stats from /api/stats.
 *
 *   npm run stats            # production (STATS_URL), readable summary
 *   npm run stats -- --json  # the raw JSON
 *   npm run stats -- --without-me  # leaving out your own devices (marked with ?track=me); combines with the others
 *   npm run stats -- --ai      # only what the app spends on model APIs (npm run spend)
 *   npm run stats -- --events  # only the events: week by week, month by month, and the latest ones one by one
 *   npm run stats -- --shares  # only sharing: links by kind, the people whose links land, generations and groups
 *   npm run stats -- --edges   # who opened whose link, as CSV (one row per sender and opener) for a graph tool
 *
 * Reads STATS_TOKEN (and optionally STATS_URL) from .env.local or the shell.
 */
const url = (process.env.STATS_URL ?? "https://canopy-admin-418538192879.us-central1.run.app").replace(/\/$/, "") + "/api/stats" + (process.argv.includes("--without-me") ? "?without=me" : "");
const token = process.env.STATS_TOKEN;
if (!token) {
  console.error("Set STATS_TOKEN in .env.local (the same value as in Vercel).");
  process.exit(1);
}

const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`${url} answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const s = await res.json();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

if (process.argv.includes("--edges")) {
  // One row per sender and opener. Load it into a graph tool, or join it to --json's sharing.nodes for the people.
  const cols = ["from", "to", "kind", "method", "firstOpenedAt", "opens", "recruited", "toActivated", "toReturned", "toShared"];
  console.log(cols.join(","));
  for (const e of s.sharing?.edges ?? []) console.log(cols.map((c) => (/[",\n]/.test(String(e[c])) ? `"${String(e[c]).replace(/"/g, )}"` : e[c])).join(","));
  process.exit(0);
}

const pct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const secs = (v) => (v == null ? "–" : v >= 60 ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s` : `${Math.round(v)}s`);
const table = (rows) => rows.length && console.table(rows);
const h = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);

const delta = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);

console.log(`${s.app} · ${s.env} · kit v${s.kit} · ${new Date(s.generatedAt).toLocaleString()} (${s.timezone})`);
if (s.owner) console.log(s.owner.excluded ? `Without your ${s.owner.devices} ${s.owner.devices === 1 ? "device" : "devices"} (marked with ?track=me)` : `Including your ${s.owner.devices} marked ${s.owner.devices === 1 ? "device" : "devices"}; --without-me leaves ${s.owner.devices === 1 ? "it" : "them"} out`);

// What the app spends on model APIs. `full` adds the day-by-day and hour-by-hour tables.
const money = (v) => (v == null ? "–" : `$${Number(v).toFixed(v < 1 ? 4 : 2)}`);
function printAi(full) {
  const a = s.ai;
  h("AI spend (list price)");
  console.log(`This month  ${money(a.monthToDate.usd)} · ${a.monthToDate.calls} calls`);
  console.log(`Today       ${money(a.today.usd)} · ${a.today.calls} calls (yesterday ${money(a.yesterday.usd)})`);
  console.log(`30 days     ${money(a.costUsd30d)} · ${a.calls30d} calls · ${delta(a.costChange)} on the 30 days before (${money(a.costUsdPrevious30d)})`);
  console.log(`All time    ${money(a.costUsdAllTime)} · ${a.callsAllTime} calls`);
  console.log(`Each        ${money(a.costPerCall30d)} per call · ${money(a.costPerActiveUser30d)} per active user · ${money(a.costPerAiUser30d)} per AI user (${a.users30d} users)`);
  console.log(`Tokens      ${a.inputTokens30d.toLocaleString()} in · ${a.outputTokens30d.toLocaleString()} out · ${a.cacheReadTokens30d.toLocaleString()} cache reads · ${a.cacheWriteTokens30d.toLocaleString()} cache writes`);
  const channels = Object.entries(a.alert.channels).filter(([, on]) => on).map(([k]) => k).join(" + ") || "no channel set";
  console.log(`Alerts      every ${money(a.alert.thresholdUsd)} a month via ${channels}${a.alert.sent.length ? ` · last sent for ${a.alert.sent[0].period} at ${money(a.alert.sent[0].usd)}` : ""}`);
  if (a.unpricedModels.length) console.log(`No price for ${a.unpricedModels.join(", ")}: costed at the highest listed rate, so these totals err high. Add the price to ai-prices.ts.`);
  table(a.byFeature30d.map((f) => ({ feature: f.feature, calls: f.calls, users: f.users, spend: money(f.costUsd), each: money(f.costPerCall), "in tokens": f.avgInputTokens, "out tokens": f.avgOutputTokens, "cache hits": pct(f.cacheHitShare) })));
  table(a.byModel30d.map((m) => ({ model: m.model, calls: m.calls, fallbacks: m.fallbackCalls, spend: m.priced ? money(m.costUsd) : `${money(m.costUsd)} (estimate)`, in: m.inputTokens, out: m.outputTokens, "cache reads": m.cacheReadTokens, "cache writes": m.cacheWriteTokens })));
  table(a.outcomes30d);
  table(a.topUsers30d.map((u) => ({ ...u, costUsd: money(u.costUsd) })));
  if (!full) return;
  table(a.daily.filter((d) => d.calls).map((d) => ({ ...d, costUsd: money(d.costUsd) })));
  table(a.byHour30d.map((x) => ({ ...x, costUsd: money(x.costUsd) })));
}
if (process.argv.includes("--ai")) {
  printAi(true);
  process.exit(0);
}

// Every event over time: one row per event, one column per period (count, with users in brackets when asked)
const overTime = (axis, key, last, withUsers) =>
  s.timeline.events.map((e) => ({
    event: e.name,
    ...Object.fromEntries(axis.slice(-last).map((k, i) => {
      const at = axis.length - Math.min(last, axis.length) + i;
      return [key === "weekly" ? k.slice(5) : k, withUsers ? `${e[key].count[at]} (${e[key].users[at]})` : e[key].count[at]];
    })),
  }));
if (process.argv.includes("--events")) {
  h("Events by week: times it happened (users), weeks by their Monday");
  table(overTime(s.timeline.weeks, "weekly", 12, true));
  h("Events by month: times it happened (users)");
  table(overTime(s.timeline.months, "monthly", 12, true));
  h("Latest events, newest first");
  table(s.recentEvents.map((e) => ({ at: new Date(e.at).toLocaleString(), event: e.name, page: e.path, ...(e.mode === "app" ? {} : { mode: e.mode }), user: e.user, source: e.source, "first seen": e.firstSeen, props: JSON.stringify(e.props) })));
  process.exit(0);
}
// Sharing by link id: which links land, whose, and who brought whom. `full` adds generations, groups and every ambassador.
function printSharing(full) {
  const sh = s.sharing;
  if (!sh || !sh.links.some((l) => l.links)) {
    if (full) console.log("\nNo links with an id yet. Links made with trackedLink() show up here once they're sent.");
    return;
  }
  h("Shared links, all time: which kind and method land (a method ending _shown was put on screen, like a QR code, never sent)");
  table(sh.links.map((l) => ({ kind: l.kind, method: l.method, links: l.links, opened: l.opened, "open rate": pct(l.openRate), openers: l.openers, "new users": l.recruits, "per link": l.recruitsPerLink ?? "–", "median to first open": secs(l.medianSecondsToOpen) })));
  h(`Ambassadors: whose links bring people in${full ? "" : " (top 10; npm run stats -- --shares for the rest)"}`);
  table(
    sh.ambassadors.slice(0, full ? 25 : 10).map((a) => ({
      user: a.me ? `${a.user} (you)` : a.user,
      source: a.source,
      "first seen": a.firstSeen,
      gen: a.generation,
      "invited by": a.invitedBy ?? "–",
      links: a.links,
      opened: pct(a.openRate),
      openers: a.openers,
      "new users": a.recruits,
      activated: a.activated,
      "came back": a.returned,
      downstream: a.descendants,
      "best kind": a.bestKind ?? "–",
    })),
  );
  if (!full) return;
  h("Ambassadors by kind of link");
  table(sh.ambassadors.flatMap((a) => a.byKind.map((k) => ({ user: a.me ? `${a.user} (you)` : a.user, kind: k.kind, links: k.links, opened: k.opened, "new users": k.recruits }))));
  h("Generations: 0 arrived on their own, 1 was brought by a 0, and so on");
  table(sh.generations.map((x) => ({ generation: x.generation, users: x.users, "who shared": x.sharers, activated: pct(x.activated) })));
  h("Groups: users joined to each other by shares");
  table(sh.groups.map((x) => ({ members: x.members, links: x.links, "new users": x.recruits, "shared both ways": x.reciprocalPairs, users: x.users.join(" ") })));
  console.log(`\n${sh.edges.length} sender-to-opener pairs and ${sh.nodes.length} people in the graph. npm run stats -- --edges > edges.csv exports the pairs.`);
}
if (process.argv.includes("--shares")) {
  printSharing(true);
  process.exit(0);
}
console.log(`Tracking since ${s.firstEventAt ? new Date(s.firstEventAt).toLocaleDateString() : "–"}`);

h("Users");
console.log(`All time   ${s.totals.users} users · ${s.totals.sessions} sessions · ${s.totals.pageviews} pageviews`);
console.log(`DAU        ${s.active.dau} today · ${s.active.dauYesterday} yesterday`);
console.log(`WAU / MAU  ${s.active.wau} / ${s.active.mau}`);
console.log(`DAU/MAU    ${pct(s.active.stickiness)}`);
const g = s.growth;
console.log(`Growth     WAU ${delta(g.wauChange)} on the week before (${g.wauPrevious}) · MAU ${delta(g.mauChange)} on the month before (${g.mauPrevious})`);
console.log(`New users  ${g.newUsers7d} in 7 days (${delta(g.newUsers7dChange)}) · ${g.newUsers30d} in 30 days (${delta(g.newUsers30dChange)})`);
// A user is one browser's id, and a person can have more than one. This leaves out the ids known to be someone's second.
const pe = s.people;
if (pe) console.log(`People     about ${pe.estimatedPeople} behind those ${pe.users} users (Home Screen apps counted apart from their browser: ${pe.duplicates.homeScreen} · merged into another id: ${pe.duplicates.merged})`);

h("Last 14 days");
table(s.daily.slice(-14).map((d) => ({ date: d.date, users: d.users, new: d.newUsers, returning: d.returningUsers, sessions: d.sessions, pageviews: d.pageviews, "DAU/MAU": pct(d.stickiness) })));

h("Engagement (30 days)");
const e = s.engagement;
console.log(`Sessions ${e.sessions} · ${e.sessionsPerUser ?? "–"} per user`);
console.log(`Session  ${secs(e.avgSessionSeconds)} average · ${secs(e.medianSessionSeconds)} median · ${e.pagesPerSession ?? "–"} pages`);
console.log(`Bounce   ${pct(e.bounceRate)} · ${secs(e.avgDailySecondsPerUser)} active per user per day`);

h("Retention");
console.log(`Came back within 1 day ${pct(s.retention.returnedWithin1Day)} · 7 days ${pct(s.retention.returnedWithin7Days)} · 30 days ${pct(s.retention.returnedWithin30Days)}`);
console.log(`Here on day 7 ${pct(s.retention.day7)} · on day 30 ${pct(s.retention.day30)}`);
// Kit v8: a first visit that bounced, with no return inside 7 days (absent from older apps' JSON)
if (s.retention.oneAndDone !== undefined) console.log(`One-and-done (first visit bounced, not back in 7 days) ${pct(s.retention.oneAndDone)}`);
table(s.retention.cohorts.map((c) => ({ week: c.week, users: c.users, ...Object.fromEntries(c.weeks.map((w, i) => [`w${i + 1}`, pct(w)])) })));

h("Weekly growth accounting (the current week is still filling in)");
table(s.lifecycle.map((w) => ({ ...w, quickRatio: w.quickRatio ?? "–" })));

h("Days active in the last 30");
table(s.activeDays30d);

if (pe) {
  const i = pe.installs;
  h("Home Screen installs");
  console.log(`Installed   opened from the Home Screen by ${i.installers} users (${pct(i.installRate)} of people)`);
  console.log(`Recorded    installs in 30 days: ${i.recorded30d} · since installs were recorded: ${i.recordedAllTime} · kept their browser's id: ${i.carried} (${pct(i.carriedRate)})`);
  console.log(`How soon    median ${secs(i.medianSecondsToInstall)} after a first visit`);
  table(
    Object.entries(i.retention).map(([k, r]) => ({
      "on their first day": k === "installedFirstDay" ? "installed" : "didn't",
      users: r.users,
      "back within 7 days": pct(r.returnedWithin7Days),
      "back within 30 days": pct(r.returnedWithin30Days),
    })),
  );
  // New users each week, and how many of them were a second id of someone already counted
  table(pe.byWeek.map((w) => ({ week: w.week, "new users": w.newUsers, "Home Screen copies": w.homeScreenCopies, merged: w.merged, "new people (estimate)": w.estimatedNewPeople })));
}

h("Shares (30 days)");
console.log(`${s.shares.created30d} created · ${s.shares.opened30d} opened · ${s.shares.newUsersFromShares30d} new users from shares (all time: ${s.shares.createdAllTime} / ${s.shares.openedAllTime})`);
console.log(`${s.shares.sharers30d} users shared (${pct(s.shares.shareRate30d)} of active) · ${s.shares.opensPerShare30d ?? "–"} opens per share · K-factor ${s.shares.kFactor30d ?? "–"}`);
table(s.shares.byKind30d);
// From a link being sent to the person who opened it coming back, by kind of link
table(
  s.shareFunnel.map((f) => ({
    kind: f.kind,
    sent: f.created,
    opens: f.opens,
    openers: f.openers,
    "opens per share": f.opensPerShare ?? "–",
    "new users": f.newUsers,
    "of openers": pct(f.newUserRate),
    activated: pct(f.activationRate),
    "came back": pct(f.returnRate),
  })),
);

printSharing(false);

// The same behaviour by where users came from and by when they arrived. Rates are of users old enough to judge; "–" is too young.
const cohortTable = (title, rows) => {
  if (!rows.length) return;
  h(title);
  table(
    rows.map((c) => ({
      cohort: c.cohort,
      users: c.users,
      "back in 1d": pct(c.returnedWithin1Day),
      "7d": pct(c.returnedWithin7Days),
      "30d": pct(c.returnedWithin30Days),
      "activated day 1": pct(c.activatedFirstDay),
      "in 7d": pct(c.activatedWithin7Days),
      "first week: sessions": c.firstWeek.sessionsPerUser ?? "–",
      days: c.firstWeek.activeDaysPerUser ?? "–",
      time: secs(c.firstWeek.activeSecondsPerUser),
      shared: pct(c.firstWeek.shared),
      ...Object.fromEntries(Object.entries(c.firstWeek.features).map(([k, v]) => [k, pct(v)])),
    })),
  );
};
cohortTable("Cohorts by source (all users, by their first visit)", s.cohorts.bySource);
cohortTable("Cohorts by week of arrival", s.cohorts.byWeek);
cohortTable("Cohorts by month of arrival", s.cohorts.byMonth);

h("Pages (30 days): [id] rows are every record of that route together");
table(
  s.topPages.map((p) => ({
    page: p.path,
    views: p.views,
    users: p.users,
    "time per view": secs(p.avgSeconds),
    "median per session": secs(p.medianSeconds),
    "per user": secs(p.secondsPerUser),
    "total time": secs(p.totalSeconds),
    "share of time": pct(p.timeShare),
    entries: p.entries,
    exits: p.exits,
    "exit rate": pct(p.exitRate),
  })),
);

h("Events (30 days)");
table(s.events);

h("Events by week (weeks by their Monday; npm run stats -- --events for users, months and the latest events)");
table(overTime(s.timeline.weeks, "weekly", 8, false));

h("Where new users came from (30 days)");
table(s.acquisition.map((a) => ({ ...a, returnRate: pct(a.returnRate) })));
table(s.campaigns);

h("When sessions start (30 days, in the stats time zone)");
const peak = Math.max(1, ...s.usageByHour.map((x) => x.sessions));
for (const x of s.usageByHour) if (x.sessions) console.log(`${String(x.hour).padStart(2, "0")}:00  ${"█".repeat(Math.ceil((x.sessions / peak) * 30))} ${x.sessions}`);
table(s.usageByWeekday);

h("Who (30 days)");
table(s.modes);
table(s.devices);
table(s.browsers);
table(s.operatingSystems);
table(s.countries);
table(s.referrers);
console.log(`Home Screen launches: ${pct(s.standaloneShare)} of sessions`);

if (s.ai.callsAllTime) printAi(false);

// This app's key flows: activation, funnels step by step, then each key feature
if (s.flows) {
  const act = s.flows.activation;
  if (act) {
    h(`Activation: ${act.label}`);
    console.log(`New users   ${act.activated30d} of ${act.newUsers30d} in the last 30 days (${pct(act.rate30d)}) · all time ${act.allTime.activated} of ${act.allTime.users} (${pct(act.allTime.rate)})`);
    console.log(`How fast    ${pct(act.rateWithin1Day)} within a day · ${pct(act.rateWithin7Days)} within a week · median ${secs(act.medianSecondsToActivate)}`);
    table(
      Object.entries(act.retention).map(([k, r]) => ({
        "on their first day": k === "activated" ? "activated" : "didn't",
        users: r.users,
        "back within 7 days": pct(r.returnedWithin7Days),
        "back within 30 days": pct(r.returnedWithin30Days),
      })),
    );
  }
  const streak = (k) => `${k.onStreak} on a 2+ day streak · ${k.onStreak7} on 7+ days · longest ever ${k.longest} days`;
  for (const f of s.flows.funnels) {
    h(`Funnel: ${f.label} (entered in the last 30 days)`);
    table(f.steps.map((x) => ({ step: x.label, users: x.users, "from previous": pct(x.fromPrevious), "drop-off": pct(x.dropoff), "from start": pct(x.fromStart) })));
    console.log(`End to end  ${f.completed} of ${f.entered} (${pct(f.completionRate)}) · median ${secs(f.medianSecondsToComplete)} · all time ${f.allTime.completed} of ${f.allTime.entered} (${pct(f.allTime.completionRate)})`);
  }
  for (const f of s.flows.features) {
    const a = f.adoption;
    const g = f.engagement;
    h(`Feature: ${f.label}`);
    console.log(`Adoption    ${a.users} users ever (${pct(a.rate)} of all) · ${a.users30d} in 30 days (${pct(a.rate30d)} of active) · ${a.newUsers30d} new`);
    console.log(`Engagement  ${g.uses30d} uses in 30 days · ${g.usesPerUser30d ?? "–"} per user on ${g.daysPerUser30d ?? "–"} days · ${pct(g.repeatRate)} used it on 2+ days · ${pct(g.repeatedWithin7Days)} again within 7 days`);
    console.log(`Streaks     ${streak(f.streaks)}`);
    table(g.weekly);
  }
  h("App streaks (any use, days in a row)");
  console.log(streak(s.flows.appStreaks));
  table(s.flows.appStreaks.byLongest);
}

// This app's own numbers: nested objects become sections, arrays become tables
const label = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const show = (v) => (typeof v === "number" && v > 0 && v < 1 && !Number.isInteger(v) ? pct(v) : v ?? "–");
function printSection(title, obj) {
  h(title);
  const nested = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) nested.push([k, v]);
    else if (v && typeof v === "object") nested.push([k, v]);
    else console.log(`${label(k).padEnd(28)} ${show(v)}`);
  }
  for (const [k, v] of nested) {
    if (Array.isArray(v)) {
      console.log(`\n${label(k)}${v.length ? "" : ": none yet"}`);
      table(v);
    } else console.log(`${label(k).padEnd(28)} ${Object.entries(v).map(([a, b]) => `${a} ${show(b)}`).join(" · ")}`);
  }
}
for (const [k, v] of Object.entries(s.appMetrics ?? {})) {
  if (v && typeof v === "object" && !Array.isArray(v)) printSection(label(k), v);
  else printSection(label(k), { [k]: v });
}
