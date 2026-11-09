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
  const codes = [];
  // 1) 인스타 내부 API (두 주소 모두 시도 — 서버에서 오면 404로 막는 경우가 있어서)
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + '/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), {
        headers: HEADERS, redirect: 'manual'
      });
      codes.push(host.replace('https://', '') + ':' + r.status);
      if (r.status === 200) {
        const j = await r.json().catch(() => null);
        if (j && j.data && j.data.user) return { user: j.data.user };
      }
    } catch (e) { codes.push(host.replace('https://', '') + ':ERR'); }
  }
  // 2) 프로필 페이지의 미리보기 문구에서 팔로워 수만 읽기
  try {
    const r = await fetch('https://www.instagram.com/' + encodeURIComponent(username) + '/', {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    codes.push('page:' + r.status);
    if (r.status === 200) {
      const html = await r.text();
      const meta = (html.match(/<meta[^>]+(?:property|name)="(?:og:)?description"[^>]+content="([^"]+)"/i) || [])[1] || '';
      const m = meta.replace(/&#x2c;|&#44;/gi, ',').match(/([\d.,]+[KMB]?)\s+Followers?,\s*([\d.,]+[KMB]?)\s+Following,\s*([\d.,]+[KMB]?)\s+Posts?/i);
      if (m) {
        const title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1] || '';
        return { lite: {
          ok: true, username, name: title.replace(/\s*\(@[^)]*\).*$/, '').replace(/&#x[0-9a-f]+;/gi, '').trim(),
          followers: toNum(m[1]), following: toNum(m[2]), posts: toNum(m[3]),
          isPrivate: false, sample: 0, avgLikes: null, avgComments: null, engagement: null
        } };
      }
      if (/Page Not Found|isn.t available/i.test(html)) return { notFound: true };
    }
  } catch (e) { codes.push('page:ERR'); }
  return { codes };
}

function toNum(t) {
  t = String(t).replace(/,/g, '');
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[t.slice(-1).toUpperCase()] || 1;
  return Math.round(parseFloat(t) * mul);
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
    if (r.notFound) return res.status(200).send(JSON.stringify({ ok: false, error: '@' + username + ' 계정을 찾을 수 없어요' }));
    if (r.lite) {
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).send(JSON.stringify(r.lite));
    }
    if (!r.user) return res.status(200).send(JSON.stringify({ ok: false, error: '인스타가 요청을 막았어요. 잠시 후 다시 시도해 주세요.', debug: r.codes }));
    // 같은 계정은 6시간 동안 Vercel이 결과를 재사용 (인스타 차단 방지)
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).send(JSON.stringify(summarize(r.user)));
  } catch (e) {
    return res.status(200).send(JSON.stringify({ ok: false, error: '가져오는 중 오류: ' + e.message }));
  }
};
