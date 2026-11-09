// Vercel 서버 함수: /api/ig?key=onsal-ig&username=아이디
const KEY = 'onsal-ig'; // 대시보드 index.html의 IG_API_KEY와 똑같이

const HEADERS = {
  'x-ig-app-id': '936619743392459',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://www.instagram.com/'
};

const HOSTS = ['https://i.instagram.com', 'https://www.instagram.com'];

async function fetchUser(username) {
  let lastCode = 0;
  for (const host of HOSTS) {
    const r = await fetch(host + '/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), {
      headers: HEADERS, redirect: 'manual'
    });
    lastCode = r.status;
    if (r.status === 404) return { code: 404 };
    if (r.status === 200) {
      try {
        const j = await r.json();
        if (j && j.data && j.data.user) return { code: 200, user: j.data.user };
      } catch (e) { /* 다음 주소로 */ }
    }
  }
  return { code: lastCode || 500 };
}

function summarize(u) {
  const edges = (u.edge_owner_to_timeline_media && u.edge_owner_to_timeline_media.edges) || [];
  const likes = edges.map(x => { const n = x.node || {}; const l = n.edge_liked_by || n.edge_media_preview_like; return l ? l.count : null; })
    .filter(v => v != null && v >= 0);
  const cmts = edges.map(x => { const c = (x.node || {}).edge_media_to_comment; return c ? c.count : null; })
    .filter(v => v != null && v >= 0);
  const avg = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null;
  const followers = u.edge_followed_by ? u.edge_followed_by.count : null;
  const avgLikes = avg(likes), avgComments = avg(cmts);
  return {
    ok: true,
    username: u.username,
    name: u.full_name || '',
    followers,
    following: u.edge_follow ? u.edge_follow.count : null,
    posts: u.edge_owner_to_timeline_media ? u.edge_owner_to_timeline_media.count : null,
    isPrivate: !!u.is_private,
    sample: edges.length,
    avgLikes,
    avgComments,
    engagement: (followers && avgLikes != null) ? ((avgLikes + (avgComments || 0)) / followers * 100).toFixed(2) : null
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const q = req.query || {};
  if (q.key !== KEY) return res.status(200).send(JSON.stringify({ ok: false, error: '연동 키가 맞지 않아요' }));

  const username = String(q.username || '').replace(/^@/, '').trim().toLowerCase();
  if (!username) return res.status(200).send(JSON.stringify({ ok: false, error: '아이디가 비어 있어요' }));

  try {
    const r = await fetchUser(username);
    if (r.code === 404) return res.status(200).send(JSON.stringify({ ok: false, error: '@' + username + ' 계정을 찾을 수 없어요' }));
    if (!r.user) return res.status(200).send(JSON.stringify({ ok: false, error: '인스타가 요청을 막았어요 (HTTP ' + r.code + '). 잠시 후 다시 시도해 주세요.' }));
    // 같은 계정은 6시간 동안 Vercel이 결과를 재사용 (인스타 차단 방지)
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).send(JSON.stringify(summarize(r.user)));
  } catch (e) {
    return res.status(200).send(JSON.stringify({ ok: false, error: '가져오는 중 오류: ' + e.message }));
  }
};
