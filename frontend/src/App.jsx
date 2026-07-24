import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

const fmt = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ko-KR");
};

function App() {
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("asc");
  const [facts, setFacts] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [detailEpisodeId, setDetailEpisodeId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadEpisodes = async () => {
    const query = new URLSearchParams({ limit: "200", sort });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const r = await fetch(`${API_BASE}/api/episodes?${query.toString()}`);
    if (!r.ok) throw new Error(`episodes 오류 (${r.status})`);
    const j = await r.json();
    setEpisodes(j.episodes || []);
  };

  const loadFacts = async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ limit: "80", offset: "0", sort });
      if (keyword) q.set("keyword", keyword);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const r = await fetch(`${API_BASE}/api/facts?${q.toString()}`);
      if (!r.ok) throw new Error(`facts 오류 (${r.status})`);
      const j = await r.json();
      setFacts(j.facts || []);
      await loadEpisodes();
    } catch (e) {
      setError(e.message || "조회 실패");
    } finally {
      setLoading(false);
    }
  };

  const openEpisode = async (id) => {
    if (!id) return;
    setDetailEpisodeId(id);
    setDetailLoading(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/episode/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`episode detail 오류 (${r.status})`);
      const j = await r.json();
      setDetail(j);
    } catch (e) {
      setError(e.message || "상세 조회 실패");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadFacts();
  }, []);

  return (
    <div className="wrap">
      <h1>역사 팟캐스트 타임라인</h1>

      <section className="panel">
        <div className="row">
          <label>
            키워드
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 문재인" />
          </label>
          <label>
            시작일
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            종료일
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            정렬
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="asc">오래된 날짜순</option>
              <option value="desc">최신 날짜순</option>
            </select>
          </label>
          <button onClick={loadFacts}>조회</button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        <h2>시간순 사건/발언</h2>
        <div className="list">
          {loading ? (
            <p>불러오는 중...</p>
          ) : facts.length === 0 ? (
            <p>해당 조건 결과가 없습니다.</p>
          ) : (
            facts.map((f, i) => (
              <article key={`${f.episode_id}-${i}`} className="card">
                <h3>{f.title || `Episode ${f.episode_id}`}</h3>
                <p className="meta">
                  날짜: {fmt(f.date)} | 구간: {f.start_sec ?? "-"}초 ~ {f.end_sec ?? "-"}초
                </p>
                <p>{f.text}</p>
                <button
                  className="link-btn"
                  onClick={() => openEpisode(f.episode_id)}
                  disabled={!f.episode_id}
                >
                  해당 에피소드 상세 보기
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <h2>에피소드 인덱스</h2>
        <div className="list">
          {episodes.length === 0 ? (
            <p>조회 결과가 없습니다.</p>
          ) : (
            episodes.map((ep, idx) => (
              <article key={idx} className="card">
                <h3>{ep.title || `Episode ${ep.episode_id}`}</h3>
                <p className="meta">방영일: {fmt(ep.published_at)}</p>
                <p className="meta">Episode id: {ep.episode_id || "미확인"}</p>
                <button
                  className="link-btn"
                  onClick={() => openEpisode(ep.episode_id)}
                  disabled={!ep.episode_id}
                >
                  발화 상세 보기
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <h2>발화 상세 뷰</h2>
        {detailLoading ? <p>상세 정보 불러오는 중...</p> : null}
        {!detailLoading && !detail ? <p>에피소드 카드를 눌러 상세 발언을 불러오세요.</p> : null}
        {detail ? (
          <div className="detail">
            <p className="meta">Episode: {detailEpisodeId}</p>
            <div className="list">
              {detail.episode ? (
                <article className="card">
                  <h3>{detail.episode.title || detailEpisodeId}</h3>
                  <p className="meta">발화 수: {detail.segments?.length || 0}개</p>
                </article>
              ) : null}
              {(detail.segments || []).map((seg) => (
                <article key={`${seg.start_sec}-${seg.idx}-${seg.text.slice(0, 10)}`} className="card">
                  <p className="meta">초 단위: {seg.start_sec ?? "-"} ~ {seg.end_sec ?? "-"} ({seg.idx ?? "-"}번 조각)</p>
                  <p>{seg.text}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default App;
