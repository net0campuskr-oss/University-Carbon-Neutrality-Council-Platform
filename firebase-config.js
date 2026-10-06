/* ============================================================
   KUCE 대학 대항전 — Firebase 연결 설정
   ------------------------------------------------------------
   Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 의 firebaseConfig 에서
   apiKey 와 databaseURL 두 값만 복사해 아래에 붙여 넣으세요.
   (이 두 값은 사이트에 공개돼도 괜찮은 값입니다. 보안은
    database.rules.json 의 규칙이 담당합니다.)

   두 값이 비어 있으면 게임은 지금처럼 이 기기 안에서만 점수를 저장하고,
   홈 화면 순위판은 '연결 준비 중'으로 표시됩니다.
   ============================================================ */
window.KUCE_FIREBASE = {
  apiKey: "",
  databaseURL: "https://kuce-ranking-default-rtdb.asia-southeast1.firebasedatabase.app"
};
