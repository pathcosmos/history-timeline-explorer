export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true }, 200, env);
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method Not Allowed" }, 405, env);
    }

    const dbUrl = (env.TIMELINE_DB_URL || "").replace(/\/$/, "");
    const token = env.TIMELINE_DB_TOKEN;
    if (!dbUrl || !token) {
      return jsonResponse({ error: "Missing DB configuration" }, 500, env);
    }

    try {
      const schema = await getSchema(dbUrl, token);

      if (path === "/api/health") {
        const rs = await executeSQL(dbUrl, token, "SELECT 1 as ok", []);
        return jsonResponse({ ok: true, data: rs.rows[0] || {} }, 200, env);
      }

      if (path === "/api/episodes") {
        const limit = clampInt(queryValue(url, "limit"), 1, 1000, 300);
        const from = queryValue(url, "from");
        const to = queryValue(url, "to");
        const sort = (queryValue(url, "sort") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

        const episodesCols = schema.episodes;
        const eTitle = pickExistingColumn(episodesCols, ["title", "name", "headline", "subject"]);
        const eId = pickExistingColumn(episodesCols, ["id", "episode_id", "canonical_id", "uuid"]);
        const eDate = pickExistingColumn(episodesCols, ["published_at", "publishedAt", "created_at", "createdAt", "air_date", "recorded_at", "inserted_at"]);

        const filters = [];
        const args = [];
        if (from && eDate) {
          filters.push(`e.${eDate} >= ?`);
          args.push(toSqlArg(from));
        }
        if (to && eDate) {
          filters.push(`e.${eDate} <= ?`);
          args.push(toSqlArg(to));
        }

        const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
        const orderBy = eDate ? eDate : "__rowid";

        const rs = await executeSQL(
          dbUrl,
          token,
          `SELECT *, rowid as __rowid FROM episodes ${whereSql} ORDER BY ${orderBy} ${sort} LIMIT ?`,
          [...args, toSqlArg(limit)],
        );

        const episodes = rs.rows
          .map((r) => ({
            episode_id: episodePrimaryId(r, eId),
            title: eTitle ? r[eTitle] : null,
            published_at: eDate ? r[eDate] : null,
            row: r,
          }));

        return jsonResponse({ episodes }, 200, env);
      }

      if (path === "/api/facts") {
        const limit = clampInt(queryValue(url, "limit"), 1, 400, 120);
        const offset = clampInt(queryValue(url, "offset"), 0, 200000, 0);
        const keyword = (queryValue(url, "keyword") || "").trim();
        const from = queryValue(url, "from");
        const to = queryValue(url, "to");
        const sort = (queryValue(url, "sort") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

        const e = schema.episodes;
        const s = schema.segments;

        const eDate = pickExistingColumn(e, ["published_at", "publishedAt", "created_at", "createdAt", "recorded_at", "inserted_at"]);
        const eId = pickExistingColumn(e, ["id", "episode_id", "canonical_id", "uuid"]);
        const eTitle = pickExistingColumn(e, ["title", "name", "headline", "subject"]);

        const sEpisodeId = pickExistingColumn(s, ["episode_id", "content_item_id", "content_id", "episode", "podcast_episode_id"]);
        const sText = pickExistingColumn(s, ["text", "transcript", "content", "segment_text"]);
        const sIdx = pickExistingColumn(s, ["segment_index", "idx", "order_idx", "seq"]);
        const sStart = pickExistingColumn(s, ["start_sec", "start", "start_time"]);
        const sEnd = pickExistingColumn(s, ["end_sec", "end", "end_time"]);

        if (!sEpisodeId || !sText) {
          return jsonResponse({ error: "Schema missing required segment columns" }, 500, env);
        }

        const likeValue = `%${escapeLike(keyword)}%`;
        const textOnlyFilter = [];
        const joinFilter = [];
        const segmentArgs = [];
        const joinArgs = [];

        if (keyword) {
          textOnlyFilter.push(`${sText} LIKE ? ESCAPE '\'`);
          joinFilter.push(`${sText} LIKE ? ESCAPE '\'`);
          const likeArg = toSqlArg(likeValue);
          segmentArgs.push(likeArg);
          joinArgs.push(likeArg);
        }
        if (from && eDate) {
          joinFilter.push(`e.${eDate} >= ?`);
          joinArgs.push(toSqlArg(from));
        }
        if (to && eDate) {
          joinFilter.push(`e.${eDate} <= ?`);
          joinArgs.push(toSqlArg(to));
        }

        const whereJoin = joinFilter.length ? `WHERE ${joinFilter.join(" AND ")}` : "";
        const whereSegment = textOnlyFilter.length ? `WHERE ${textOnlyFilter.join(" AND ")}` : "";
        let facts = [];

        if (sEpisodeId && eId && eDate) {
          const segOrderExpr = sIdx || "segment_rowid";
          const factsSql = `
            SELECT
              s.rowid as segment_rowid,
              s.${sEpisodeId} as segment_episode_id,
              s.${sText} as segment_text,
              ${sStart ? `s.${sStart}` : "NULL"} as start_sec,
              ${sEnd ? `s.${sEnd}` : "NULL"} as end_sec,
              ${sIdx ? `s.${sIdx}` : "NULL"} as seg_idx,
              e.${eId} as ep_id,
              ${eTitle ? `e.${eTitle}` : "NULL"} as ep_title,
              e.${eDate} as ep_date
            FROM segments s
            LEFT JOIN episodes e
              ON CAST(s.${sEpisodeId} AS TEXT) = CAST(e.${eId} AS TEXT)
            ${whereJoin}
            ORDER BY e.${eDate} ${sort}, ${segOrderExpr} ${sort}
            LIMIT ? OFFSET ?`;

          const rs = await executeSQL(dbUrl, token, factsSql.trim(), [...joinArgs, toSqlArg(limit), toSqlArg(offset)]);
          facts = rs.rows.map((r) => ({
            episode_id: r.ep_id ?? r.segment_episode_id,
            title: eTitle ? r.ep_title : null,
            date: eDate ? r.ep_date : null,
            start_sec: r.start_sec,
            end_sec: r.end_sec,
            idx: r.seg_idx,
            text: r.segment_text || "",
          }));
        } else {
          const segmentSql = `SELECT *, rowid as __rowid FROM segments ${whereSegment} ORDER BY ${sEpisodeId} ${sort}, ${sIdx || "__rowid"} ${sort} LIMIT ? OFFSET ?`;
          const segRs = await executeSQL(dbUrl, token, segmentSql, [...segmentArgs, toSqlArg(limit), toSqlArg(offset)]);

          const epRs = await executeSQL(dbUrl, token, "SELECT *, rowid as __rowid FROM episodes", []);
          const episodeById = new Map();
          for (const row of epRs.rows) {
            const key = episodePrimaryId(row, eId);
            if (key != null) episodeById.set(String(key), row);
            episodeById.set(String(row.__rowid), row);
          }

          const filtered = [];
          for (const r of segRs.rows) {
            const episodeId = String(r[sEpisodeId]);
            const ep = episodeById.get(episodeId) || episodeById.get(String(r.__rowid)) || {};
            const eventDate = eDate ? ep[eDate] : null;
            if (!passDateFilter(eventDate, from, to, true, !eDate)) {
              continue;
            }

            filtered.push({
              episode_id: episodePrimaryId(ep, eId) || episodeId,
              title: eTitle ? ep[eTitle] : null,
              date: eventDate,
              start_sec: sStart ? r[sStart] : null,
              end_sec: sEnd ? r[sEnd] : null,
              idx: sIdx ? r[sIdx] : null,
              text: r[sText] || "",
            });
          }

          facts = filtered.sort((a, b) => {
            const aDate = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
            const bDate = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
            if (aDate !== bDate) {
              return sort === "ASC" ? aDate - bDate : bDate - aDate;
            }
            const aIdx = Number(a.idx ?? 0);
            const bIdx = Number(b.idx ?? 0);
            return aIdx - bIdx;
          });
        }

        return jsonResponse(
          {
            keyword: keyword || null,
            facts,
            pagination: { limit, offset, returned: facts.length },
          },
          200,
          env,
        );
      }

      if (path.startsWith("/api/episode/")) {
        const rawId = decodeURIComponent(path.replace("/api/episode/", ""));
        if (!rawId) {
          return jsonResponse({ error: "Missing episode id" }, 400, env);
        }

        const s = schema.segments;
        const e = schema.episodes;

        const sEpisodeId = pickExistingColumn(s, ["episode_id", "content_item_id", "content_id", "episode", "podcast_episode_id"]);
        const sText = pickExistingColumn(s, ["text", "transcript", "content", "segment_text"]);
        const sStart = pickExistingColumn(s, ["start_sec", "start", "start_time"]);
        const sEnd = pickExistingColumn(s, ["end_sec", "end", "end_time"]);
        const sIdx = pickExistingColumn(s, ["segment_index", "idx", "order_idx", "seq"]);
        const eId = pickExistingColumn(e, ["id", "episode_id", "canonical_id", "uuid"]);

        if (!eId || !sEpisodeId || !sText) {
          return jsonResponse({ error: "Schema missing required columns" }, 500, env);
        }

        let episode = null;
        try {
          const byBusinessId = await executeSQL(dbUrl, token, `SELECT *, rowid as __rowid FROM episodes WHERE ${eId} = ? LIMIT 1`, [toSqlArg(rawId)]);
          if (byBusinessId.rows.length > 0) {
            episode = byBusinessId.rows[0];
          }
        } catch (_err) {
          // no-op, some schemas may not support chosen id column
        }

        if (!episode) {
          const byRowId = await executeSQL(dbUrl, token, "SELECT *, rowid as __rowid FROM episodes WHERE rowid = ? LIMIT 1", [toSqlArg(toIntegerMaybe(rawId))]);
          episode = byRowId.rows.length > 0 ? byRowId.rows[0] : null;
        }

        if (!episode) {
          return jsonResponse({ error: "Episode not found" }, 404, env);
        }

        const segRows = await executeSQL(
          dbUrl,
          token,
          `SELECT *, rowid as __rowid FROM segments WHERE ${sEpisodeId} = ? ORDER BY ${sIdx || "__rowid"} ASC`,
          [toSqlArg(episodePrimaryId(episode, eId) || String(episode.__rowid))],
        );

        return jsonResponse(
          {
            episode,
            segments: segRows.rows.map((r) => ({
              idx: sIdx ? r[sIdx] : null,
              start_sec: sStart ? r[sStart] : null,
              end_sec: sEnd ? r[sEnd] : null,
              text: r[sText] || "",
            })),
          },
          200,
          env,
        );
      }

      return jsonResponse({ error: "Not Found" }, 404, env);
    } catch (err) {
      return jsonResponse({ error: String(err.message || err) }, 500, env);
    }
  },
};

async function getSchema(dbUrl, token) {
  const ep = await executeSQL(dbUrl, token, "PRAGMA table_info(episodes)", []);
  const seg = await executeSQL(dbUrl, token, "PRAGMA table_info(segments)", []);
  return {
    episodes: ep.rows.map((r) => ({ name: r.name, type: r.type })),
    segments: seg.rows.map((r) => ({ name: r.name, type: r.type })),
  };
}

function episodePrimaryId(row, candidateId) {
  if (!row) return null;
  const byCandidate = candidateId ? row[candidateId] : null;
  if (byCandidate !== null && byCandidate !== undefined) return byCandidate;
  return row.__rowid ?? null;
}

function passDateFilter(value, from, to, _default = true, noDateColumn = false) {
  if (noDateColumn) return true;
  if (!from && !to) return true;
  if (!value) return _default;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  if (from) {
    const f = new Date(from);
    if (!Number.isNaN(f.getTime()) && d < f) return false;
  }
  if (to) {
    const t = new Date(to);
    if (!Number.isNaN(t.getTime()) && d > t) return false;
  }
  return true;
}

function pickExistingColumn(columns, candidates) {
  const set = new Set(columns.map((c) => c.name));
  for (const name of candidates) {
    if (set.has(name)) return name;
  }
  return null;
}

function jsonResponse(payload, status = 200, env) {
  const origin = (env && env.ALLOWED_ORIGINS) ? env.ALLOWED_ORIGINS : "*";
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}

function queryValue(url, key) {
  return url.searchParams.get(key);
}

function clampInt(raw, min, max, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function toIntegerMaybe(value) {
  const n = Number(value);
  return Number.isNaN(n) ? value : Math.trunc(n);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toSqlArg(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number" && Number.isInteger(value)) {
    return { type: "integer", value: String(value) };
  }
  if (typeof value === "number") {
    return { type: "float", value };
  }
  if (typeof value === "boolean") {
    return { type: "integer", value: value ? 1 : 0 };
  }
  return { type: "text", value: String(value) };
}

function decodeCell(cell) {
  if (cell == null) return null;
  if (typeof cell === "object" && cell.type && Object.prototype.hasOwnProperty.call(cell, "value")) {
    if (cell.type === "null") return null;
    if (cell.type === "integer") return Number(cell.value);
    if (cell.type === "float") return Number(cell.value);
    return cell.value;
  }
  return cell;
}

function normalizeRow(cols, row) {
  const obj = {};
  for (let i = 0; i < cols.length; i++) {
    const key = cols[i];
    obj[key] = decodeCell(row?.[i]);
  }
  return obj;
}

async function executeSQL(dbUrl, token, sql, args) {
  const response = await fetch(`${dbUrl}/v1/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      stmt: {
        sql,
        args,
        named_args: [],
        want_rows: true,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DB request failed (${response.status}): ${text}`);
  }

  const data = JSON.parse(text);
  const cols = (data.result?.cols || []).map((c) => c.name || "");
  const rows = (data.result?.rows || []).map((row) => normalizeRow(cols, row));
  return { rows, cols, raw: data };
}
