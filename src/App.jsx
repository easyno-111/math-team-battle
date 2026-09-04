import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import ExcelQuestionImporter from "./components/ExcelQuestionImporter";
import GameRoomManager from "./components/GameRoomManager";
import StudentLobby from "./components/StudentLobby";
import "./App.css";

const VERSION = "v0.4.0";

function getStudentRoute() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = (params.get("join") || "").replace(/\D/g, "").slice(0, 4);
  const studentMode = params.get("mode") === "student" || Boolean(joinCode);
  return { studentMode, joinCode };
}

function openStudentEntry() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "student");
  window.location.href = url.toString();
}

/* x^2 → x², x_1 → x₁ 형태로 화면에 표시 */
function MathText({ text = "" }) {
  const regex = /([A-Za-z0-9)\]])([\^_])(\{[^}]+\}|-?\d+|[A-Za-z])/g;
  const result = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }

    let value = match[3];
    if (value.startsWith("{") && value.endsWith("}")) {
      value = value.slice(1, -1);
    }

    result.push(
      <span key={key++}>
        {match[1]}
        {match[2] === "^" ? <sup>{value}</sup> : <sub>{value}</sub>}
      </span>
    );

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push(<span key={key}>{text.slice(lastIndex)}</span>);
  }

  return <>{result}</>;
}

function App() {
  const { studentMode, joinCode } = useMemo(() => getStudentRoute(), []);

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!studentMode);
  const [activeSection, setActiveSection] = useState(() =>
    window.location.hash === "#room" ? "room" : "questions"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [unit, setUnit] = useState("");
  const [difficulty, setDifficulty] = useState("보통");

  const [questions, setQuestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (studentMode) return undefined;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, [studentMode]);

  useEffect(() => {
    if (studentMode || !user) {
      return undefined;
    }

    const questionsRef = collection(db, "questions");

    const unsubscribe = onSnapshot(
      questionsRef,
      (snapshot) => {
        const list = snapshot.docs.map((questionDoc) => ({
          id: questionDoc.id,
          ...questionDoc.data(),
        }));

        list.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });

        setQuestions(list);
      },
      (error) => {
        console.error("문제 불러오기 오류:", error);
        setMessage("문제를 불러오지 못했습니다.");
      }
    );

    return unsubscribe;
  }, [studentMode, user]);

  const handleLogin = async (event) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setLoginError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError("");
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error(error);
      setLoginError("이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleAddQuestion = async (event) => {
    event.preventDefault();

    if (!question.trim()) {
      setMessage("문제를 입력해주세요.");
      return;
    }

    if (!answer.trim()) {
      setMessage("정답을 입력해주세요.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      await addDoc(collection(db, "questions"), {
        question: question.trim(),
        answer: answer.trim(),
        unit: unit.trim(),
        difficulty,
        enabled: true,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      setQuestion("");
      setAnswer("");
      setMessage("문제가 저장되었습니다.");
    } catch (error) {
      console.error("문제 저장 오류:", error);

      if (error.code === "permission-denied") {
        setMessage("저장 권한이 없습니다. Firestore 관리자 설정을 확인해주세요.");
      } else {
        setMessage("문제를 저장하지 못했습니다.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (questionId) => {
    try {
      setDeletingId(questionId);
      setMessage("");
      await deleteDoc(doc(db, "questions", questionId));
      setConfirmDeleteId(null);
      setMessage("문제가 삭제되었습니다.");
    } catch (error) {
      console.error("문제 삭제 오류:", error);

      if (error.code === "permission-denied") {
        setMessage("삭제 권한이 없습니다. Firestore 관리자 권한을 확인해주세요.");
      } else {
        setMessage("문제를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const changeSection = (section) => {
    setActiveSection(section);
    window.history.replaceState(null, "", section === "room" ? "#room" : window.location.pathname);
  };

  if (studentMode) {
    return <StudentLobby initialRoomCode={joinCode} version={VERSION} />;
  }

  if (authLoading) {
    return (
      <main className="app-shell">
        <div className="loading-card">
          <span className="soft-spinner" />
          <p>수학 팀 배틀을 불러오는 중이에요.</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <section className="login-card">
          <div className="logo-mark">수</div>
          <p className="soft-kicker">수학 팀 배틀</p>
          <h1>관리자 로그인</h1>
          <p className="subtitle">문제은행과 게임방을 관리하려면 로그인해주세요.</p>

          <form onSubmit={handleLogin}>
            <label>
              관리자 이메일
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="이메일을 입력하세요"
              />
            </label>

            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="비밀번호를 입력하세요"
              />
            </label>

            {loginError && <div className="error-message">{loginError}</div>}

            <button className="primary-button" disabled={loginLoading}>
              {loginLoading ? "로그인 중..." : "교사 로그인"}
            </button>
          </form>

          <button type="button" className="student-entry-link" onClick={openStudentEntry}>
            학생으로 입장하기
          </button>

          <footer>{VERSION}</footer>
        </section>
      </main>
    );
  }

  return (
    <main className={`admin-shell ${activeSection === "room" ? "room-section-active" : ""}`}>
      <div className="pastel-blob pastel-blob-one" />
      <div className="pastel-blob pastel-blob-two" />

      <header className="admin-header">
        <div className="brand-block">
          <div className="brand-icon">수</div>
          <div>
            <p className="soft-kicker">수학 팀 배틀</p>
            <h1>{activeSection === "questions" ? "문제은행" : "게임방"}</h1>
            <p className="header-description">
              {activeSection === "questions"
                ? "수업에 사용할 문제를 차곡차곡 모아두는 곳이에요."
                : "학생을 두 팀으로 나누고 경기 전 대기실을 준비해요."}
            </p>
          </div>
        </div>

        <nav className="admin-nav" aria-label="관리자 메뉴">
          <button
            type="button"
            className={activeSection === "questions" ? "active" : ""}
            onClick={() => changeSection("questions")}
          >
            문제은행
          </button>
          <button
            type="button"
            className={activeSection === "room" ? "active" : ""}
            onClick={() => changeSection("room")}
          >
            게임방
          </button>
        </nav>

        <div className="header-actions">
          <span className="question-count">문제 {questions.length}개</span>
          <button className="secondary-button" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </header>

      {activeSection === "questions" ? (
        <>
          <div className="dashboard-grid">
            <section className="panel editor-panel">
              <div className="panel-title">
                <div>
                  <span className="section-pill lavender">하나씩 추가</span>
                  <h2>새 문제 만들기</h2>
                  <p className="panel-description">간단한 문제는 여기서 바로 저장할 수 있어요.</p>
                </div>
              </div>

              <form className="question-form" onSubmit={handleAddQuestion}>
                <div className="form-row">
                  <label>
                    단원
                    <input
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      placeholder="예: 이차방정식"
                    />
                  </label>

                  <label>
                    난이도
                    <select
                      value={difficulty}
                      onChange={(event) => setDifficulty(event.target.value)}
                    >
                      <option>쉬움</option>
                      <option>보통</option>
                      <option>어려움</option>
                      <option>도전</option>
                    </select>
                  </label>
                </div>

                <label>
                  문제
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="예: x^2 - 5x + 6 = 0의 해를 구하시오."
                    rows={5}
                  />
                </label>

                <div className="preview-box">
                  <span className="preview-label">학생 화면에서는 이렇게 보여요</span>
                  <div className="question-preview">
                    {question ? (
                      <MathText text={question} />
                    ) : (
                      <span className="preview-empty">문제를 입력하면 여기에서 미리 볼 수 있어요.</span>
                    )}
                  </div>
                </div>

                <label>
                  정답
                  <input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="예: 2, 3"
                  />
                </label>

                {message && <div className="status-message">{message}</div>}

                <button className="primary-button" disabled={saving}>
                  {saving ? "저장 중..." : "문제 저장하기"}
                </button>
              </form>
            </section>

            <section className="panel question-list-panel">
              <div className="panel-title list-panel-title">
                <div>
                  <span className="section-pill mint">저장된 문제</span>
                  <h2>문제 목록</h2>
                  <p className="panel-description">잘못 넣은 문제는 오른쪽의 삭제 버튼으로 지울 수 있어요.</p>
                </div>
                <span className="round-count">{questions.length}</span>
              </div>

              {questions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-illustration">?</div>
                  <strong>아직 저장된 문제가 없어요.</strong>
                  <p>왼쪽에서 첫 문제를 만들어보세요.</p>
                </div>
              ) : (
                <div className="question-list">
                  {questions.map((item, index) => {
                    const isConfirming = confirmDeleteId === item.id;
                    const isDeleting = deletingId === item.id;

                    return (
                      <article className="question-item" key={item.id}>
                        <div className="question-number">{questions.length - index}</div>

                        <div className="question-body">
                          <div className="question-topline">
                            <div className="question-meta">
                              {item.unit && <span className="unit-tag">{item.unit}</span>}
                              <span className={`difficulty-tag difficulty-${item.difficulty}`}>
                                {item.difficulty}
                              </span>
                            </div>

                            {!isConfirming && (
                              <button
                                type="button"
                                className="delete-button"
                                onClick={() => setConfirmDeleteId(item.id)}
                                aria-label="문제 삭제"
                              >
                                삭제
                              </button>
                            )}
                          </div>

                          <div className="saved-question">
                            <MathText text={item.question} />
                          </div>

                          <div className="saved-answer">
                            <span>정답</span>
                            <strong>{item.answer}</strong>
                          </div>

                          {isConfirming && (
                            <div className="delete-confirm-box">
                              <div>
                                <strong>이 문제를 삭제할까요?</strong>
                                <p>삭제한 문제는 되돌릴 수 없어요.</p>
                              </div>
                              <div className="delete-confirm-actions">
                                <button
                                  type="button"
                                  className="cancel-delete-button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={isDeleting}
                                >
                                  취소
                                </button>
                                <button
                                  type="button"
                                  className="confirm-delete-button"
                                  onClick={() => handleDeleteQuestion(item.id)}
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? "삭제 중..." : "삭제하기"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <ExcelQuestionImporter user={user} questions={questions} />
        </>
      ) : (
        <GameRoomManager
          user={user}
          questions={questions}
          onGoQuestionBank={() => changeSection("questions")}
        />
      )}

      <div className="version-badge">{VERSION}</div>
    </main>
  );
}

export default App;
