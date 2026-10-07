import { useEffect, useMemo, useState } from "react";
import { browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { VERSION } from "./version";
import GameRoomManager from "./room/GameRoomManager";
import StudentLobby from "./components/StudentLobby";
import QuizHost, { QuizStudent } from "./quiz/Live";
import QuestionBankPage from "./questions/QuestionBankPage";
import ArenaPreview from "./battle/ArenaPreview";
import "./styles/base.css";
import "./styles/questions.css";
import "./styles/room.css";
import "./styles/student.css";

const SECTIONS = {
  questions: { title: "문제은행", description: "4지선다 문제를 모아두고 게임에 바로 사용할 수 있어요.", hash: "" },
  room: { title: "게임방", description: "학생을 팀으로 나누고 박 터뜨리기 대결을 진행해요.", hash: "#room" },
  quiz: { title: "퀴즈 모드", description: "문제 세트를 준비하고 모두 함께 푸는 퀴즈를 진행해요.", hash: "#quiz" },
};

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = (params.get("join") || "").replace(/\D/g, "").slice(0, 4);
  const quizStudent = params.get("mode") === "quizstudent" || params.has("quiz");
  const quizCode = (params.get("quiz") || "").replace(/\D/g, "").slice(0, 6);
  const studentMode = quizStudent || params.get("mode") === "student" || Boolean(joinCode);
  const preview = params.get("mode") === "preview";
  const section = Object.keys(SECTIONS).find((key) => SECTIONS[key].hash && SECTIONS[key].hash === window.location.hash) || "questions";
  return { studentMode, joinCode, quizStudent, quizCode, section, preview };
}

function openStudentEntry(mode) {
  const url = new URL(window.location.href);
  url.search = `?mode=${mode}`;
  url.hash = "";
  window.location.href = url.toString();
}

function LoginScreen({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <main className="app-shell">
      <section className="login-card">
        <div className="logo-mark">수</div>
        <p className="soft-kicker">수학 팀 배틀</p>
        <h1>관리자 로그인</h1>
        <p className="subtitle">문제은행과 게임방을 관리하려면 로그인해주세요.</p>
        <form onSubmit={(event) => { event.preventDefault(); onLogin(email.trim(), password); }}>
          <label>관리자 이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="이메일을 입력하세요" /></label>
          <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="비밀번호를 입력하세요" /></label>
          {error && <div className="error-message">{error}</div>}
          <button className="primary-button" disabled={loading}>{loading ? "로그인 중..." : "교사 로그인"}</button>
          <p className="admin-device-memory-hint">이 기기에서는 로그인 상태를 기억해 다음 접속부터 바로 관리자 화면으로 들어갑니다.</p>
        </form>
        <button type="button" className="student-entry-link" onClick={() => openStudentEntry("student")}>학생으로 입장하기</button>
        <button type="button" className="student-entry-link" onClick={() => openStudentEntry("quizstudent")}>퀴즈 학생 입장 (6자리 방 번호)</button>
        <footer>{VERSION}</footer>
      </section>
    </main>
  );
}

export default function App() {
  const route = useMemo(() => readRoute(), []);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!route.studentMode && !route.preview);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [section, setSection] = useState(route.section);
  const [questions, setQuestions] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [quizImportNotice, setQuizImportNotice] = useState("");

  useEffect(() => {
    if (route.studentMode || route.preview) return undefined;
    setPersistence(auth, browserLocalPersistence).catch((error) => console.warn("관리자 로그인 유지 설정 오류:", error));
    return onAuthStateChanged(auth, (firebaseUser) => { setUser(firebaseUser); setAuthLoading(false); });
  }, [route.studentMode, route.preview]);

  useEffect(() => {
    if (route.studentMode || route.preview || !user) return undefined;
    return onSnapshot(collection(db, "questions"), (snapshot) => {
      const list = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setQuestions(list);
      setLoadError("");
    }, (error) => {
      console.error("문제 불러오기 오류:", error);
      setLoadError("문제를 불러오지 못했습니다.");
    });
  }, [route.studentMode, route.preview, user]);

  const changeSection = (next) => {
    setSection(next);
    window.history.replaceState(null, "", `${window.location.pathname}${SECTIONS[next].hash}`);
  };

  const login = async (email, password) => {
    if (!email || !password) { setLoginError("이메일과 비밀번호를 입력해주세요."); return; }
    setLoginLoading(true);
    setLoginError("");
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error(error);
      setLoginError("이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoginLoading(false);
    }
  };

  if (route.preview) return <ArenaPreview />;
  if (route.studentMode) {
    return route.quizStudent
      ? <QuizStudent initialCode={route.quizCode} version={VERSION} />
      : <StudentLobby initialRoomCode={route.joinCode} version={VERSION} />;
  }
  if (authLoading) {
    return <main className="app-shell"><div className="loading-card"><span className="soft-spinner" /><p>수학 팀 배틀을 불러오는 중이에요.</p></div></main>;
  }
  if (!user) return <LoginScreen onLogin={login} loading={loginLoading} error={loginError} />;

  return (
    <main className={`admin-shell ${section === "room" ? "room-section-active" : ""}`}>
      <header className="admin-header">
        <div className="brand-block">
          <div className="brand-icon">수</div>
          <div>
            <p className="soft-kicker">수학 팀 배틀</p>
            <h1>{SECTIONS[section].title}</h1>
            <p className="header-description">{SECTIONS[section].description}</p>
          </div>
        </div>
        <nav className="admin-nav" aria-label="관리자 메뉴">
          {Object.entries(SECTIONS).map(([key, meta]) => (
            <button type="button" key={key} className={section === key ? "active" : ""} onClick={() => changeSection(key)}>{meta.title}</button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="question-count">문제 {questions.length}개</span>
          <button className="secondary-button" onClick={() => signOut(auth)}>로그아웃</button>
        </div>
      </header>

      {section === "questions" && (
        <QuestionBankPage
          user={user}
          questions={questions}
          loadError={loadError}
          onSendToQuiz={(notice) => { setQuizImportNotice(notice); changeSection("quiz"); }}
        />
      )}
      {section === "quiz" && <QuizHost key={user.uid} user={user} questions={questions} importNotice={quizImportNotice} onImportNoticeClear={() => setQuizImportNotice("")} />}
      {section === "room" && <GameRoomManager user={user} questions={questions} onGoQuestionBank={() => changeSection("questions")} />}

      <div className="version-badge">{VERSION}</div>
    </main>
  );
}
