// 화면을 그리기 전에 저장해 둔 배색과 글씨체를 먼저 적용한다 (깜빡임 방지).
// 페이지 안에 직접 쓰지 않고 파일로 둔 이유: 보안 헤더가 페이지 안 스크립트를 막기 때문이다.
try {
  document.documentElement.dataset.theme = localStorage.getItem('go-theme') || 'pink';
  document.documentElement.dataset.font = localStorage.getItem('go-font') || 'jakarta';
} catch (e) {}
