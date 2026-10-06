/* ============================================================
   KUCE 대학 대항전 — 실시간 점수 연동 (Firebase Realtime Database REST)
   ------------------------------------------------------------
   - game.html : 게임 시작/종료 때 점수를 서버에 기록
   - index.html: 홈 화면 캠페인 섹션의 학교별 실시간 순위
   SDK 없이 REST 로 동작합니다. 설정은 firebase-config.js 에서 합니다.

   점수 검사(조작 방지)는 database.rules.json 이 서버에서 합니다.
     · 게임 시작 기록이 있어야 점수 제출 가능
     · 시작 후 25초 이상, 15분 이내에만 제출 가능 (한 판 30초)
     · 한 판 점수 0~1300 (게임 규칙상 최고점 이하)
     · 시작 기록 1개당 점수 1번만
     · 같은 기기(익명 계정)는 25초에 한 판만 시작 가능
============================================================ */
(function () {
  'use strict';

  // 게임(game.html)의 학교 id 와 같아야 합니다. 로고는 assets/logos 의 파일입니다.
  var SCHOOLS = [
    { id: 'yonsei',  name: '연세대학교',     logo: 'yonsei.png' },
    { id: 'skku',    name: '성균관대학교',   logo: 'skku.png' },
    { id: 'korea',   name: '고려대학교',     logo: 'korea.png' },
    { id: 'ewha',    name: '이화여자대학교', logo: 'ewha.png' },
    { id: 'hanyang', name: '한양대학교',     logo: 'hanyang.png' },
    { id: 'khu',     name: '경희대학교',     logo: 'khu.png' },
    { id: 'cau',     name: '중앙대학교',     logo: 'cau.png' },
    { id: 'snu',     name: '서울대학교',     logo: 'snu.png' },
    { id: 'konkuk',  name: '건국대학교',     logo: 'konkuk.png' },
    { id: 'kangwon', name: '강원대학교',     logo: 'kangwon.png' },
    { id: 'cbnu',    name: '충북대학교',     logo: 'cbnu.png' },
    { id: 'cnu',     name: '충남대학교',     logo: 'cnu.png' },
    { id: 'jbnu',    name: '전북대학교',     logo: 'jbnu.png' },
    { id: 'jnu',     name: '전남대학교',     logo: 'jnu.png' },
    { id: 'knu',     name: '경북대학교',     logo: 'knu.jpg' },
    { id: 'kmu',     name: '계명대학교',     logo: 'keimyung.jpg' },
    { id: 'yu',      name: '영남대학교',     logo: 'yu.png' },
    { id: 'postech', name: '포항공과대학교', logo: 'postech.png' },
    { id: 'pnu',     name: '부산대학교',     logo: 'pnu.png' },
    { id: 'gnu',     name: '경상국립대학교', logo: 'gnu.png' }
  ];
  var MAX_SCORE = 1300;            // database.rules.json 과 같은 값
  var AUTH_KEY = 'kuce:anon-auth:v1';

  function cfg() {
    var c = window.KUCE_FIREBASE || {};
    return (c.apiKey && c.databaseURL) ? c : null;
  }

  /* ---------- REST 주소 ---------- */
  function dbUrl(path, token) {
    var c = cfg();
    var u = new URL(c.databaseURL);
    u.pathname = u.pathname.replace(/\/$/, '') + '/' + path + '.json';
    if (token) u.searchParams.set('auth', token);
    return u.toString();
  }
  function authUrl(kind) {
    var c = cfg();
    var host = c.authEmulator ? c.authEmulator.replace(/\/$/, '') + '/' : 'https://';
    return kind === 'signUp'
      ? host + 'identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(c.apiKey)
      : host + 'securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(c.apiKey);
  }

  /* ---------- 익명 로그인 (기기별 제한용) ---------- */
  function loadAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { return null; } }
  function saveAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {} }
  var authMem = null, authPending = null;

  async function getToken() {
    var a = authMem || loadAuth();
    if (a && a.idToken && a.exp - Date.now() > 60000) { authMem = a; return a; }
    if (authPending) return authPending;
    authPending = (async function () {
      var res, j;
      if (a && a.refreshToken) {
        res = await fetch(authUrl('refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refreshToken)
        });
        if (res.ok) {
          j = await res.json();
          a = { uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + Number(j.expires_in) * 1000 };
          authMem = a; saveAuth(a); return a;
        }
      }
      res = await fetch(authUrl('signUp'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      });
      if (!res.ok) throw new Error('익명 로그인 실패 (' + res.status + ')');
      j = await res.json();
      a = { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + Number(j.expiresIn) * 1000 };
      authMem = a; saveAuth(a); return a;
    })();
    try { return await authPending; } finally { authPending = null; }
  }

  async function patchRoot(body) {
    var a = await getToken();
    var res = await fetch(dbUrl('', a.idToken), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(a.uid))
    });
    if (!res.ok) throw new Error('기록 실패 (' + res.status + ') ' + (await res.text()).slice(0, 200));
    return res.json();
  }

  function newId() {
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var arr = new Uint8Array(20), s = '';
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) s += abc[arr[i] % abc.length];
    return s;
  }
  var TS = { '.sv': 'timestamp' };

  /* ---------- 학교별 순위 (공개 읽기) ---------- */
  async function fetchSchoolTotals() {
    if (!cfg()) throw new Error('not-configured');
    var res = await fetch(dbUrl('schools'), { cache: 'no-store' });
    if (!res.ok) throw new Error('순위 불러오기 실패 (' + res.status + ')');
    var data = (await res.json()) || {};
    var list = SCHOOLS.map(function (s) {
      var d = data[s.id] || {};
      return { id: s.id, name: s.name, logo: s.logo, total: Number(d.total) || 0, plays: Number(d.plays) || 0 };
    });
    list.sort(function (a, b) { return b.total - a.total || b.plays - a.plays || a.name.localeCompare(b.name, 'ko'); });
    var rank = 0, prev = null;
    list.forEach(function (r, i) { if (r.total !== prev) rank = i + 1; prev = r.total; r.rank = rank; });
    return list;
  }

  /* ---------- 게임용 점수 서비스 ----------
     local : 게임에 원래 있던 '이 기기 저장' 서비스 (개인 최고점 표시에 계속 사용)
     연결 설정이 없으면 local 을 그대로 돌려줍니다. */
  function makeScoreService(local) {
    if (!cfg()) return local;
    var round = null;

    return {
      live: true,

      // 카운트다운이 끝나고 실제 플레이가 시작될 때 호출
      startRound: function (schoolId) {
        var sid = newId();
        var r = { sid: sid, schoolId: schoolId };
        r.ok = patchRoot(function (uid) {
          var b = {};
          b['sessions/' + sid] = { uid: uid, school: schoolId, t: TS };
          b['players/' + uid + '/last'] = TS;
          return b;
        }).then(function () { return true; }, function (e) { console.warn('[KUCE] 게임 시작 기록 실패:', e); return false; });
        round = r;
      },

      // 결과 화면이 뜰 때 호출
      submitScore: async function (p) {
        var pb = await local.submitScore(p);
        var r = round; round = null;
        var score = Math.max(0, Math.min(MAX_SCORE, Math.round(Number(p.score) || 0)));
        if (r && r.schoolId === p.schoolId && await r.ok) {
          try {
            await patchRoot(function () {
              var b = {}, s = p.schoolId;
              b['scores/' + r.sid] = { school: s, score: score, t: TS };
              b['schools/' + s + '/total'] = { '.sv': { increment: score } };
              b['schools/' + s + '/plays'] = { '.sv': { increment: 1 } };
              b['schools/' + s + '/last'] = r.sid;
              return b;
            });
          } catch (e) { console.warn('[KUCE] 점수 기록 실패:', e); }
        }
        return pb;
      },

      // 게임 결과 화면의 '대학 게임 랭킹'
      getRanking: async function () {
        var list = await fetchSchoolTotals();
        return list.map(function (r) {
          return { schoolId: r.id, schoolName: r.name, score: r.total, plays: r.plays, rank: r.rank };
        });
      }
    };
  }

  window.KUCE_SCORES = {
    configured: function () { return !!cfg(); },
    schools: SCHOOLS,
    fetchSchoolTotals: fetchSchoolTotals
  };
  window.KUCE_makeScoreService = makeScoreService;
})();
