import { useEffect, useMemo, useState } from "react";
import {
  browserLocalPersistence,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  setPersistence,
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
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import ExcelQuestionImporter from "./components/ExcelQuestionImporter";
import GameRoomManager from "./components/GameRoomManager";
import AIQuestionGenerator from "./components/AIQuestionGenerator";
import SimilarQuestionGenerator from "./components/SimilarQuestionGenerator";
import MathText from "./components/MathText";
import StudentLobby from "./components/StudentLobby";
import QuizHost, { QuizStudent } from "./quiz/Live";
import { appendBankQuestions, prepareBank, readQuizDraft } from "./quiz/bank";
import { isMultipleChoiceQuestion } from "./utils/questionExcel";
import "./App.css";

const VERSION = "v0.15.0";
const LEGACY_CATEGORY = "기존 문제";
const CHOICE_LABELS = ["①", "②", "③", "④"];
const DELETE_BATCH_SIZE = 400;

function getStudentRoute() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = (params.get("join") || "").replace(/\D/g, "").slice(0, 4);
  const quizStudent = params.get("mode") === "quizstudent" || params.has("quiz");
  const quizCode = (params.get("quiz") || "").replace(/\D/g, "").slice(0, 6);
  const studentMode = quizStudent || params.get("mode") === "student" || Boolean(joinCode);
  return { studentMode, joinCode, quizStudent, quizCode };
}

function openStudentEntry() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "student");
  window.location.href = url.toString();
}

function normalizeChoice(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko");
}

function getQuestionCategory(item) {
  const value = String(item?.category || item?.subject || "").trim();
  return value || LEGACY_CATEGORY;
}

function getQuestionUnit(item) {
  return String(item?.unit || "").trim() || "주제 미지정";
}

function makeQuestionGroupKey(category, unit) {
  return `${category}::${unit}`;
}

function App() {
  const { studentMode, joinCode, quizStudent, quizCode } = useMemo(() => getStudentRoute(), []);

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!studentMode);
  const [activeSection, setActiveSection] = useState(() => {
    if (window.location.hash === "#quiz") return "quiz";
    if (window.location.hash === "#room") return "room";
    if (window.location.hash === "#ai") return "ai";
    return "questions";
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", "", "", ""]);
  const [correctOption, setCorrectOption] = useState(1);
  const [explanation, setExplanation] = useState("");
  const [category, setCategory] = useState("공통수학2");
  const [unit, setUnit] = useState("");
  const [difficulty, setDifficulty] = useState("보통");

  const [questions, setQuestions] = useState([]);
  const [quizImportNotice, setQuizImportNotice] = useState("");
  const [quizImportError, setQuizImportError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [expandedUnits, setExpandedUnits] = useState(() => new Set());

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("전체");
  const [filterUnit, setFilterUnit] = useState("전체");
  const [filterDifficulty, setFilterDifficulty] = useState("전체");
  const [filterEnabled, setFilterEnabled] = useState("전체");

  const [selectedQuestionIds, setSelectedQuestionIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("공통수학2");
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [updatingEnabledId, setUpdatingEnabledId] = useState(null);
  const [similarQuestionSources, setSimilarQuestionSources] = useState([]);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllPassword, setDeleteAllPassword] = useState("");
  const [deleteAllError, setDeleteAllError] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    if (studentMode) return undefined;

    // 교사 기기는 로그인 세션을 브라우저에 유지한다.
    // 한 번 로그인한 기기에서는 다음 접속부터 Firebase가 세션을 복구해 로그인 화면을 건너뛴다.
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.warn("관리자 로그인 유지 설정 오류:", error);
    });

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

  const questionCategories = useMemo(() => {
    return [...new Set(questions.map((item) => getQuestionCategory(item)))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions]);

  const questionUnits = useMemo(() => {
    return [...new Set(
      questions
        .filter((item) => filterCategory === "전체" || getQuestionCategory(item) === filterCategory)
        .map((item) => String(item.unit || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "ko"));
  }, [filterCategory, questions]);

  const allQuestionUnits = useMemo(() => {
    return [...new Set(questions.map((item) => String(item.unit || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase("ko");

    return questions.filter((item) => {
      if (filterCategory !== "전체" && getQuestionCategory(item) !== filterCategory) return false;
      if (filterUnit !== "전체" && item.unit !== filterUnit) return false;
      if (filterDifficulty !== "전체" && item.difficulty !== filterDifficulty) return false;
      if (filterEnabled === "사용 중" && item.enabled === false) return false;
      if (filterEnabled === "출제 제외" && item.enabled !== false) return false;
      if (!keyword) return true;

      const haystack = [
        getQuestionCategory(item),
        item.unit,
        item.difficulty,
        item.question,
        ...(Array.isArray(item.choices) ? item.choices : []),
        item.answer,
        item.explanation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko");

      return haystack.includes(keyword);
    });
  }, [filterCategory, filterDifficulty, filterEnabled, filterUnit, questions, searchTerm]);

  const objectiveCount = useMemo(
    () => questions.filter(isMultipleChoiceQuestion).length,
    [questions]
  );
  const enabledCount = useMemo(
    () => questions.filter((item) => item.enabled !== false).length,
    [questions]
  );
  const disabledCount = questions.length - enabledCount;
  const legacyCount = questions.length - objectiveCount;
  const questionGroups = useMemo(() => {
    const groups = new Map();

    filteredQuestions.forEach((item) => {
      const groupCategory = getQuestionCategory(item);
      const groupName = getQuestionUnit(item);
      const key = makeQuestionGroupKey(groupCategory, groupName);
      if (!groups.has(key)) groups.set(key, { category: groupCategory, name: groupName, items: [] });
      groups.get(key).items.push(item);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        key: makeQuestionGroupKey(group.category, group.name),
        difficultyCounts: group.items.reduce((acc, item) => {
          const level = item.difficulty || "미지정";
          acc[level] = (acc[level] || 0) + 1;
          return acc;
        }, {}),
        enabledCount: group.items.filter((item) => item.enabled !== false).length,
        disabledCount: group.items.filter((item) => item.enabled === false).length,
      }))
      .sort((a, b) => {
        const categoryCompare = a.category.localeCompare(b.category, "ko");
        return categoryCompare || a.name.localeCompare(b.name, "ko");
      });
  }, [filteredQuestions]);

  const autoExpandQuestionGroups =
    Boolean(searchTerm.trim()) ||
    filterCategory !== "전체" ||
    filterDifficulty !== "전체" ||
    filterEnabled !== "전체" ||
    filterUnit !== "전체";

  const toggleQuestionGroup = (groupKey) => {
    setExpandedUnits((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const expandAllQuestionGroups = () => {
    setExpandedUnits(new Set(questionGroups.map((group) => group.key)));
  };

  const collapseAllQuestionGroups = () => {
    setExpandedUnits(new Set());
  };


  const selectedCount = selectedQuestionIds.size;
  const visibleQuestionIds = useMemo(() => filteredQuestions.map((item) => item.id), [filteredQuestions]);
  const allVisibleSelected = visibleQuestionIds.length > 0 && visibleQuestionIds.every((id) => selectedQuestionIds.has(id));

  function sendSelectedToQuiz() {
    try {
      const chosen=questions.filter(item=>selectedQuestionIds.has(item.id));
      const prepared=prepareBank(chosen);
      if(!prepared.length)throw new Error('출제에 포함된 유효한 객관식 문제를 선택해주세요.');
      const key=`qm-draft:${user.uid}`;
      const draft=readQuizDraft(localStorage.getItem(key));
      const result=appendBankQuestions(draft,prepared);
      localStorage.setItem(key,JSON.stringify(result.draft));
      setQuizImportNotice(`문제은행에서 ${result.added}문제를 퀴즈 초안에 담았습니다. 총 ${result.draft.questions.length}문제입니다.${result.skipped?` 중복 ${result.skipped}문제는 제외했습니다.`:''}${chosen.length-prepared.length?` 출제 제외 또는 형식이 맞지 않는 ${chosen.length-prepared.length}문제는 가져오지 않았습니다.`:''} 세트 저장을 눌러 보관하세요.`);
      setQuizImportError('');
      changeSection('quiz');
    }catch(error){setQuizImportError(error.message || '퀴즈 초안을 저장하지 못했습니다.');}
  }

  const toggleQuestionSelection = (questionId) => {
    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
    setBulkDeleteConfirm(false);
  };

  const toggleGroupSelection = (items) => {
    const ids = items.map((item) => item.id);
    const allSelected = ids.every((id) => selectedQuestionIds.has(id));
    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    setBulkDeleteConfirm(false);
  };

  const toggleVisibleSelection = () => {
    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      visibleQuestionIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    setBulkDeleteConfirm(false);
  };

  const clearQuestionSelection = () => {
    setSelectedQuestionIds(new Set());
    setBulkDeleteConfirm(false);
  };

  const openSimilarQuestionGenerator = (items) => {
    const objectiveItems = items.filter(isMultipleChoiceQuestion);
    if (!objectiveItems.length) {
      setMessage("유사문제 생성은 현재 4지선다 문제에서 사용할 수 있습니다.");
      return;
    }
    if (objectiveItems.length > 10) {
      setMessage("유사문제 일괄 생성은 한 번에 최대 10개 원본까지 처리합니다. 앞의 10개만 가져옵니다.");
    }
    setSimilarQuestionSources(objectiveItems.slice(0, 10));
  };

  const openSelectedSimilarQuestionGenerator = () => {
    const selectedItems = questions.filter((item) => selectedQuestionIds.has(item.id));
    openSimilarQuestionGenerator(selectedItems);
  };

  const handleToggleQuestionEnabled = async (item) => {
    const nextEnabled = item.enabled === false;
    try {
      setUpdatingEnabledId(item.id);
      await updateDoc(doc(db, "questions", item.id), {
        enabled: nextEnabled,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      setMessage(nextEnabled ? "문제를 다시 게임 출제에 포함했습니다." : "문제를 게임 출제에서 제외했습니다.");
    } catch (error) {
      console.error("문제 사용 상태 변경 오류:", error);
      setMessage("문제 사용 상태를 바꾸지 못했습니다.");
    } finally {
      setUpdatingEnabledId(null);
    }
  };

  const handleBulkSetEnabled = async (enabled) => {
    const ids = [...selectedQuestionIds];
    if (ids.length === 0) return;

    try {
      setBulkBusy(true);
      for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
        const chunk = ids.slice(start, start + DELETE_BATCH_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((questionId) => {
          batch.update(doc(db, "questions", questionId), {
            enabled,
            updatedBy: user.uid,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      setMessage(`${ids.length}개 문제를 ${enabled ? "출제에 포함" : "출제에서 제외"}했습니다.`);
    } catch (error) {
      console.error("문제 일괄 상태 변경 오류:", error);
      setMessage("선택한 문제의 사용 상태를 바꾸지 못했습니다.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkSetCategory = async () => {
    const ids = [...selectedQuestionIds];
    const cleanCategory = bulkCategoryValue.trim();
    if (ids.length === 0) return;
    if (!cleanCategory) {
      setMessage("지정할 분야/과목을 입력해주세요.");
      return;
    }

    try {
      setBulkBusy(true);
      for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
        const chunk = ids.slice(start, start + DELETE_BATCH_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((questionId) => {
          batch.update(doc(db, "questions", questionId), {
            category: cleanCategory,
            updatedBy: user.uid,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      setMessage(`${ids.length}개 문제의 분야/과목을 '${cleanCategory}'(으)로 지정했습니다.`);
    } catch (error) {
      console.error("문제 일괄 분야 변경 오류:", error);
      setMessage("선택한 문제의 분야/과목을 바꾸지 못했습니다.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDeleteSelected = async () => {
    const ids = [...selectedQuestionIds];
    if (ids.length === 0) return;

    try {
      setBulkBusy(true);
      for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
        const chunk = ids.slice(start, start + DELETE_BATCH_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((questionId) => batch.delete(doc(db, "questions", questionId)));
        await batch.commit();
      }

      if (editingQuestionId && selectedQuestionIds.has(editingQuestionId)) resetEditor();
      setSelectedQuestionIds(new Set());
      setBulkDeleteConfirm(false);
      setMessage(`${ids.length}개 문제를 삭제했습니다.`);
    } catch (error) {
      console.error("선택 문제 삭제 오류:", error);
      setMessage("선택한 문제를 삭제하지 못했습니다.");
    } finally {
      setBulkBusy(false);
    }
  };

  const resetEditor = () => {
    setEditingQuestionId(null);
    setQuestion("");
    setChoices(["", "", "", ""]);
    setCorrectOption(1);
    setExplanation("");
    setCategory("공통수학2");
    setUnit("");
    setDifficulty("보통");
  };

  const startEditingQuestion = (item) => {
    if (!isMultipleChoiceQuestion(item)) {
      setMessage("이전 단답형 문제는 새 객관식 형식으로 다시 등록해주세요.");
      return;
    }

    setEditingQuestionId(item.id);
    setQuestion(item.question || "");
    setChoices(Array.isArray(item.choices) ? item.choices.slice(0, 4) : ["", "", "", ""]);
    setCorrectOption(Number(item.correctOption || 1));
    setExplanation(item.explanation || "");
    setCategory(getQuestionCategory(item));
    setUnit(item.unit || "");
    setDifficulty(item.difficulty || "보통");
    setConfirmDeleteId(null);
    setMessage("수정할 내용을 고친 뒤 아래의 저장 버튼을 눌러주세요.");
    window.requestAnimationFrame(() => {
      document.querySelector(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };


  const handleLogin = async (event) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setLoginError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError("");
      await setPersistence(auth, browserLocalPersistence);
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

  const updateChoice = (index, value) => {
    setChoices((current) => current.map((choice, choiceIndex) => (
      choiceIndex === index ? value : choice
    )));
  };

  const handleAddQuestion = async (event) => {
    event.preventDefault();

    const cleanQuestion = question.trim();
    const cleanCategory = category.trim();
    const cleanUnit = unit.trim();
    const cleanChoices = choices.map((choice) => choice.trim());

    if (!cleanCategory) {
      setMessage("분야/과목을 입력해주세요.");
      return;
    }

    if (!cleanUnit) {
      setMessage("주제/단원을 입력해주세요.");
      return;
    }

    if (!cleanQuestion) {
      setMessage("문제를 입력해주세요.");
      return;
    }

    if (cleanChoices.some((choice) => !choice)) {
      setMessage("보기 4개를 모두 입력해주세요.");
      return;
    }

    if (new Set(cleanChoices.map(normalizeChoice)).size !== 4) {
      setMessage("보기 4개는 서로 다른 내용이어야 합니다.");
      return;
    }

    if (!Number.isInteger(correctOption) || correctOption < 1 || correctOption > 4) {
      setMessage("정답 보기를 선택해주세요.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const payload = {
        type: "multiple-choice",
        schemaVersion: 2,
        question: cleanQuestion,
        choices: cleanChoices,
        correctOption,
        explanation: explanation.trim(),
        category: cleanCategory,
        unit: cleanUnit,
        difficulty,
        enabled: true,
      };

      if (editingQuestionId) {
        await updateDoc(doc(db, "questions", editingQuestionId), {
          ...payload,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
        resetEditor();
        setMessage("문제를 수정했습니다.");
      } else {
        await addDoc(collection(db, "questions"), {
          ...payload,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          source: "manual",
        });
        setQuestion("");
        setChoices(["", "", "", ""]);
        setCorrectOption(1);
        setExplanation("");
        setMessage("객관식 문제가 저장되었습니다.");
      }
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
      setSelectedQuestionIds((current) => {
        if (!current.has(questionId)) return current;
        const next = new Set(current);
        next.delete(questionId);
        return next;
      });
      if (editingQuestionId === questionId) resetEditor();
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

  const openDeleteAll = () => {
    setDeleteAllPassword("");
    setDeleteAllError("");
    setDeleteAllOpen(true);
  };

  const closeDeleteAll = () => {
    if (deletingAll) return;
    setDeleteAllOpen(false);
    setDeleteAllPassword("");
    setDeleteAllError("");
  };

  const handleDeleteAllQuestions = async (event) => {
    event.preventDefault();

    if (!deleteAllPassword) {
      setDeleteAllError("관리자 로그인 비밀번호를 다시 입력해주세요.");
      return;
    }

    if (!user?.email) {
      setDeleteAllError("현재 관리자 이메일을 확인할 수 없습니다.");
      return;
    }

    const ids = questions.map((item) => item.id);
    if (ids.length === 0) {
      setDeleteAllOpen(false);
      return;
    }

    try {
      setDeletingAll(true);
      setDeleteAllError("");

      const credential = EmailAuthProvider.credential(user.email, deleteAllPassword);
      await reauthenticateWithCredential(user, credential);

      for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
        const chunk = ids.slice(start, start + DELETE_BATCH_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((questionId) => batch.delete(doc(db, "questions", questionId)));
        await batch.commit();
      }

      setDeleteAllOpen(false);
      setDeleteAllPassword("");
      setSelectedQuestionIds(new Set());
      setBulkDeleteConfirm(false);
      setMessage(`${ids.length}개 문제를 모두 삭제했습니다.`);
    } catch (error) {
      console.error("전체 문제 삭제 오류:", error);
      const code = error?.code || "";

      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/invalid-login-credentials"
      ) {
        setDeleteAllError("비밀번호가 올바르지 않습니다.");
      } else if (code === "auth/too-many-requests") {
        setDeleteAllError("비밀번호 확인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.");
      } else if (code === "permission-denied") {
        setDeleteAllError("문제 삭제 권한이 없습니다. Firestore 규칙을 확인해주세요.");
      } else {
        setDeleteAllError("전체 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setDeletingAll(false);
    }
  };

  const changeSection = (section) => {
    setActiveSection(section);
    const hash = section === "quiz" ? "#quiz" : section === "room" ? "#room" : section === "ai" ? "#ai" : "";
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  };

  if (studentMode) {
    return quizStudent ? <QuizStudent initialCode={quizCode} version={VERSION} /> : <StudentLobby initialRoomCode={joinCode} version={VERSION} />;
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

            <p className="admin-device-memory-hint">이 기기에서는 로그인 상태를 기억해 다음 접속부터 바로 관리자 화면으로 들어갑니다.</p>
          </form>

          <button type="button" className="student-entry-link" onClick={openStudentEntry}>
            학생으로 입장하기
          </button>

          <button type="button" className="student-entry-link" onClick={() => { const url = new URL(window.location.href); url.search = "?mode=quizstudent"; url.hash = ""; window.location.href = url.toString(); }}>퀴즈 학생 입장 (6자리 방 번호)</button>
          <footer>{VERSION}</footer>
        </section>
      </main>
    );
  }

  return (
    <main className={`admin-shell ${activeSection === "room" ? "room-section-active" : ""} ${activeSection === "ai" ? "ai-section-active" : ""}`}>

      <header className="admin-header">
        <div className="brand-block">
          <div className="brand-icon">수</div>
          <div>
            <p className="soft-kicker">수학 팀 배틀</p>
            <h1>
              {activeSection === "questions" ? "문제은행" : activeSection === "ai" ? "AI 문제 만들기" : activeSection === "quiz" ? "퀴즈 모드" : "게임방"}
            </h1>
            <p className="header-description">
              {activeSection === "questions"
                ? "4지선다 문제를 모아두고 게임에 바로 사용할 수 있어요."
                : activeSection === "ai"
                  ? "Gemini로 새 문제를 만들고 확인한 문제만 문제은행에 추가해요."
                  : activeSection === "quiz" ? "문제 세트를 준비하고 모두 함께 푸는 퀴즈를 진행해요." : "학생을 팀으로 나누고 경기 전 대기실을 준비해요."}
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
            className={activeSection === "ai" ? "active" : ""}
            onClick={() => changeSection("ai")}
          >
            AI 문제 만들기
          </button>
          <button
            type="button"
            className={activeSection === "room" ? "active" : ""}
            onClick={() => changeSection("room")}
          >
            게임방
          </button>
          <button type="button" className={activeSection === "quiz" ? "active" : ""} onClick={() => changeSection("quiz")}>퀴즈 모드</button>
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
          {legacyCount > 0 && (
            <div className="legacy-question-notice">
              <div>
                <strong>이전 단답형 문제 {legacyCount}개가 남아 있어요.</strong>
                <p>v0.5.2부터 경기는 4지선다 문제만 사용합니다. 새 양식을 넣기 전에 전체 삭제로 정리하는 것을 권장해요.</p>
              </div>
              <button type="button" onClick={openDeleteAll}>전체 문제 정리</button>
            </div>
          )}

          <div className="dashboard-grid">
            <section className="panel editor-panel">
              <div className="panel-title">
                <div>
                  <span className="section-pill lavender">{editingQuestionId ? "문제 수정" : "4지선다 추가"}</span>
                  <h2>{editingQuestionId ? "객관식 문제 수정하기" : "새 객관식 문제 만들기"}</h2>
                  <p className="panel-description">
                    {editingQuestionId ? "저장된 문제의 내용과 보기를 고칠 수 있어요." : "보기 네 개와 정답 하나를 정해 저장해요."}
                  </p>
                </div>
              </div>

              <form className="question-form" onSubmit={handleAddQuestion}>
                <div className="form-row">
                  <label>
                    분야 / 과목
                    <input
                      list="question-category-options"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      placeholder="예: 공통수학2, 상식퀴즈"
                    />
                    <datalist id="question-category-options">
                      {questionCategories.map((item) => <option key={item} value={item} />)}
                    </datalist>
                  </label>

                  <label>
                    주제 / 단원
                    <input
                      list="question-unit-options"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      placeholder="예: 평면좌표, 세계 상식"
                    />
                    <datalist id="question-unit-options">
                      {allQuestionUnits.map((item) => <option key={item} value={item} />)}
                    </datalist>
                  </label>
                </div>

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

                <label>
                  문제
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="예: 두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오."
                    rows={4}
                  />
                </label>

                <div className="preview-box multiple-choice-preview">
                  <span className="preview-label">학생 화면 미리보기</span>
                  <div className="question-preview">
                    {question ? (
                      <MathText text={question} />
                    ) : (
                      <span className="preview-empty">문제를 입력하면 여기에서 미리 볼 수 있어요.</span>
                    )}
                  </div>
                  <div className="preview-choice-list">
                    {choices.map((choice, index) => (
                      <div key={`preview-${index}`} className={correctOption === index + 1 ? "is-answer" : ""}>
                        <span>{CHOICE_LABELS[index]}</span>
                        <b><MathText text={choice || `보기 ${index + 1}`}/></b>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="choice-editor-list">
                  {choices.map((choice, index) => (
                    <label className="choice-editor-row" key={`choice-${index}`}>
                      <span className="choice-editor-label">{CHOICE_LABELS[index]} 보기 {index + 1}</span>
                      <input
                        value={choice}
                        onChange={(event) => updateChoice(index, event.target.value)}
                        placeholder={`보기 ${index + 1} 내용을 입력하세요`}
                      />
                      <span className="correct-choice-selector">
                        <input
                          type="radio"
                          name="correctOption"
                          checked={correctOption === index + 1}
                          onChange={() => setCorrectOption(index + 1)}
                        />
                        정답
                      </span>
                    </label>
                  ))}
                </div>

                <label>
                  해설 <span className="optional-label">선택</span>
                  <textarea
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                    placeholder="나중에 오답 풀이 기능에 사용할 해설을 적어둘 수 있어요."
                    rows={3}
                  />
                </label>

                {explanation && <div className="math-edit-preview"><small>해설 미리보기</small><MathText text={explanation}/></div>}
                {message && <div className="status-message">{message}</div>}

                <div className="editor-save-actions">
                  {editingQuestionId && (
                    <button type="button" className="secondary-button" onClick={resetEditor} disabled={saving}>
                      수정 취소
                    </button>
                  )}
                  <button className="primary-button" disabled={saving}>
                    {saving ? "저장 중..." : editingQuestionId ? "수정 내용 저장하기" : "객관식 문제 저장하기"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel question-list-panel">
              <div className="panel-title list-panel-title">
                <div>
                  <span className="section-pill mint">저장된 문제</span>
                  <h2>분야 · 주제별 문제 목록</h2>
                  <p className="panel-description">목록 칸 안에서 스크롤하며 분야와 주제별로 관리할 수 있어요.</p>
                </div>
                <span className="round-count">{questions.length}</span>
              </div>

              <div className="question-bank-toolbar">
                <input
                  className="question-search-input"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="문제, 보기, 분야, 주제 검색"
                />
                <select
                  value={filterCategory}
                  onChange={(event) => {
                    setFilterCategory(event.target.value);
                    setFilterUnit("전체");
                  }}
                >
                  <option>전체</option>
                  {questionCategories.map((item) => <option key={item}>{item}</option>)}
                </select>
                <select value={filterUnit} onChange={(event) => setFilterUnit(event.target.value)}>
                  <option>전체</option>
                  {questionUnits.map((questionUnit) => (
                    <option key={questionUnit}>{questionUnit}</option>
                  ))}
                </select>
                <select
                  value={filterDifficulty}
                  onChange={(event) => setFilterDifficulty(event.target.value)}
                >
                  <option>전체</option>
                  <option>쉬움</option>
                  <option>보통</option>
                  <option>어려움</option>
                  <option>도전</option>
                </select>
                <select value={filterEnabled} onChange={(event) => setFilterEnabled(event.target.value)}>
                  <option>전체</option>
                  <option>사용 중</option>
                  <option>출제 제외</option>
                </select>
                <button
                  type="button"
                  className="delete-all-trigger"
                  onClick={openDeleteAll}
                  disabled={questions.length === 0}
                >
                  문제 전체 삭제
                </button>
              </div>

              <div className="question-bank-summary question-bank-summary-with-fold">
                <div>
                  <span>객관식 <strong>{objectiveCount}</strong></span>
                  <span>사용 중 <strong>{enabledCount}</strong></span>
                  {disabledCount > 0 && <span>출제 제외 <strong>{disabledCount}</strong></span>}
                  {legacyCount > 0 && <span>이전 형식 <strong>{legacyCount}</strong></span>}
                  <span>현재 표시 <strong>{filteredQuestions.length}</strong></span>
                  <span>분야 <strong>{questionCategories.length}</strong></span>
                  <span>주제 <strong>{questionGroups.length}</strong></span>
                </div>
                <div className="question-fold-actions">
                  <button type="button" onClick={expandAllQuestionGroups} disabled={questionGroups.length === 0}>
                    전체 펼치기
                  </button>
                  <button type="button" onClick={collapseAllQuestionGroups} disabled={questionGroups.length === 0}>
                    전체 접기
                  </button>
                </div>
              </div>

              {filteredQuestions.length > 0 && (
                <div className={`question-bulk-bar ${selectedCount > 0 ? "has-selection" : ""}`}>
                  <div className="question-bulk-selection">
                    <label className="soft-check bulk-select-all">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                      />
                      <span />
                      현재 표시 전체 선택
                    </label>
                    <strong>{selectedCount}개 선택</strong>
                    {selectedCount > 0 && (
                      <button type="button" className="bulk-clear-button" onClick={clearQuestionSelection} disabled={bulkBusy}>
                        선택 해제
                      </button>
                    )}
                  </div>

                  {selectedCount > 0 && (
                    <div className="question-bulk-actions">
                      <button type="button" className="bulk-quiz-button" onClick={sendSelectedToQuiz} disabled={bulkBusy}>퀴즈 초안에 담기</button>
                      <div className="bulk-category-editor">
                        <input
                          list="bulk-category-options"
                          value={bulkCategoryValue}
                          onChange={(event) => setBulkCategoryValue(event.target.value)}
                          placeholder="분야/과목"
                          aria-label="선택 문제 분야/과목"
                        />
                        <datalist id="bulk-category-options">
                          {questionCategories.map((item) => <option key={item} value={item} />)}
                        </datalist>
                        <button type="button" onClick={handleBulkSetCategory} disabled={bulkBusy}>
                          분야 지정
                        </button>
                      </div>
                      <button
                        type="button"
                        className="bulk-variant-button"
                        onClick={openSelectedSimilarQuestionGenerator}
                        disabled={bulkBusy}
                      >
                        유사문제 일괄
                      </button>
                      <button type="button" className="bulk-enable-button" onClick={() => handleBulkSetEnabled(true)} disabled={bulkBusy}>
                        출제에 포함
                      </button>
                      <button type="button" className="bulk-disable-button" onClick={() => handleBulkSetEnabled(false)} disabled={bulkBusy}>
                        출제 제외
                      </button>
                      {!bulkDeleteConfirm ? (
                        <button type="button" className="bulk-delete-button" onClick={() => setBulkDeleteConfirm(true)} disabled={bulkBusy}>
                          선택 삭제
                        </button>
                      ) : (
                        <div className="bulk-delete-confirm">
                          <span>{selectedCount}개를 삭제할까요?</span>
                          <button type="button" onClick={() => setBulkDeleteConfirm(false)} disabled={bulkBusy}>취소</button>
                          <button type="button" className="confirm" onClick={handleBulkDeleteSelected} disabled={bulkBusy}>
                            {bulkBusy ? "처리 중..." : "삭제"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {quizImportError && <p className="status-message" role="alert">{quizImportError}</p>}
              <div className="question-scroll-box" tabIndex={0} aria-label="저장된 문제 스크롤 영역">
              {questions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-illustration">?</div>
                  <strong>아직 저장된 문제가 없어요.</strong>
                  <p>왼쪽에서 첫 객관식 문제를 만들어보세요.</p>
                </div>
              ) : filteredQuestions.length === 0 ? (
                <div className="empty-state compact-empty-state">
                  <strong>조건에 맞는 문제가 없어요.</strong>
                  <p>검색어나 필터를 바꿔보세요.</p>
                </div>
              ) : (
                <div className="question-unit-accordion">
                  {questionGroups.map((group) => {
                    const isOpen = autoExpandQuestionGroups || expandedUnits.has(group.key);
                    const groupObjectiveCount = group.items.filter(isMultipleChoiceQuestion).length;

                    return (
                      <section className={`question-unit-group ${isOpen ? "open" : ""}`} key={group.key}>
                        <div className="question-unit-header">
                          <label className="soft-check question-unit-select" title={`${group.name} 전체 선택`}>
                            <input
                              type="checkbox"
                              checked={group.items.length > 0 && group.items.every((item) => selectedQuestionIds.has(item.id))}
                              onChange={() => toggleGroupSelection(group.items)}
                            />
                            <span />
                          </label>
                          <button
                            type="button"
                            className="question-unit-toggle"
                            onClick={() => toggleQuestionGroup(group.key)}
                            aria-expanded={isOpen}
                          >
                            <span className="question-unit-chevron">{isOpen ? "−" : "+"}</span>
                            <span className="question-unit-main">
                              <span className="question-category-mini">{group.category}</span>
                              <strong>{group.name}</strong>
                              <small>
                                {group.items.length}문제 · 사용 {group.enabledCount}
                                {group.disabledCount > 0 ? ` · 제외 ${group.disabledCount}` : ""}
                                {` · 객관식 ${groupObjectiveCount}`}
                              </small>
                            </span>
                            <span className="question-unit-difficulty-counts">
                              {["쉬움", "보통", "어려움", "도전"].map((level) => (
                                group.difficultyCounts[level] ? (
                                  <i key={level} className={`difficulty-${level}`}>
                                    {level} {group.difficultyCounts[level]}
                                  </i>
                                ) : null
                              ))}
                            </span>
                            <span className="question-unit-open-label">{isOpen ? "접기" : "펼치기"}</span>
                          </button>
                        </div>

                        {isOpen && (
                          <div className="question-unit-items">
                            {group.items.map((item) => {
                              const isConfirming = confirmDeleteId === item.id;
                              const isDeleting = deletingId === item.id;
                              const isObjective = isMultipleChoiceQuestion(item);
                              const answerText = isObjective
                                ? item.choices[item.correctOption - 1]
                                : item.answer || "-";

                              return (
                                <article
                                  className={`question-item ${editingQuestionId === item.id ? "is-editing" : ""} ${selectedQuestionIds.has(item.id) ? "is-selected" : ""} ${item.enabled === false ? "is-disabled" : ""}`}
                                  key={item.id}
                                >
                                  <label className="soft-check question-item-select" title="문제 선택">
                                    <input
                                      type="checkbox"
                                      checked={selectedQuestionIds.has(item.id)}
                                      onChange={() => toggleQuestionSelection(item.id)}
                                    />
                                    <span />
                                  </label>
                                  <div className="question-number">
                                    {questions.findIndex((questionItem) => questionItem.id === item.id) + 1}
                                  </div>

                                  <div className="question-body">
                                    <div className="question-topline">
                                      <div className="question-meta">
                                        <span className={`difficulty-tag difficulty-${item.difficulty}`}>
                                          {item.difficulty}
                                        </span>
                                        <span className={`format-tag ${isObjective ? "objective" : "legacy"}`}>
                                          {isObjective ? "4지선다" : "이전 단답형"}
                                        </span>
                                        <span className={`use-status-tag ${item.enabled === false ? "off" : "on"}`}>
                                          {item.enabled === false ? "출제 제외" : "사용 중"}
                                        </span>
                                      </div>

                                      {!isConfirming && (
                                        <div className="question-item-actions">
                                          <button
                                            type="button"
                                            className={`question-enabled-toggle ${item.enabled === false ? "off" : "on"}`}
                                            onClick={() => handleToggleQuestionEnabled(item)}
                                            disabled={updatingEnabledId === item.id || bulkBusy}
                                          >
                                            {updatingEnabledId === item.id
                                              ? "변경 중..."
                                              : item.enabled === false
                                                ? "다시 사용"
                                                : "출제 제외"}
                                          </button>
                                          {isObjective && (
                                            <button
                                              type="button"
                                              className="edit-question-button"
                                              onClick={() => openSimilarQuestionGenerator([item])}
                                            >
                                              유사문제
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            className="edit-question-button"
                                            onClick={() => startEditingQuestion(item)}
                                          >
                                            수정
                                          </button>
                                          <button
                                            type="button"
                                            className="delete-button"
                                            onClick={() => setConfirmDeleteId(item.id)}
                                            aria-label="문제 삭제"
                                          >
                                            삭제
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <div className="saved-question">
                                      <MathText text={item.question} />
                                    </div>

                                    {isObjective && (
                                      <div className="saved-choice-list">
                                        {item.choices.map((choice, index) => (
                                          <div
                                            key={`${item.id}-choice-${index}`}
                                            className={item.correctOption === index + 1 ? "correct" : ""}
                                          >
                                            <span>{CHOICE_LABELS[index]}</span>
                                            <MathText text={choice} />
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    <div className="saved-answer">
                                      <span>정답</span>
                                      <strong>
                                        {isObjective ? `${CHOICE_LABELS[item.correctOption - 1]} ` : ""}
                                        <MathText text={answerText} />
                                      </strong>
                                    </div>

                                    {isObjective && item.explanation && (
                                      <div className="saved-explanation">
                                        <span>해설</span>
                                        <p><MathText text={item.explanation} /></p>
                                      </div>
                                    )}

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
                    );
                  })}
                </div>
              )}
              </div>
            </section>
          </div>

          <ExcelQuestionImporter user={user} questions={questions} />
        </>
      ) : activeSection === "quiz" ? (<QuizHost key={user.uid} user={user} questions={questions} importNotice={quizImportNotice} onImportNoticeClear={()=>setQuizImportNotice('')} />) : activeSection === "ai" ? (
        <AIQuestionGenerator
          db={db}
          user={user}
          questions={questions}
          questionUnits={allQuestionUnits}
          questionCategories={questionCategories}
          onMessage={setMessage}
        />
      ) : (
        <GameRoomManager
          user={user}
          questions={questions}
          onGoQuestionBank={() => changeSection("questions")}
        />
      )}

      {similarQuestionSources.length > 0 && (
        <SimilarQuestionGenerator
          db={db}
          user={user}
          sourceQuestions={similarQuestionSources}
          allQuestions={questions}
          onClose={() => setSimilarQuestionSources([])}
          onMessage={setMessage}
        />
      )}

      {deleteAllOpen && (
        <div className="delete-all-overlay" role="presentation" onMouseDown={closeDeleteAll}>
          <section className="delete-all-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="delete-all-icon">!</div>
            <span className="section-pill peach">위험 작업</span>
            <h2>문제를 전부 삭제할까요?</h2>
            <p>
              현재 문제은행의 <strong>{questions.length}개 문제</strong>가 모두 삭제됩니다.
              관리자 계정은 그대로 유지되고 문제 데이터만 지워집니다.
            </p>
            <p className="delete-all-warning">삭제한 문제는 되돌릴 수 없습니다.</p>

            <form onSubmit={handleDeleteAllQuestions}>
              <label>
                관리자 로그인 비밀번호 다시 입력
                <input
                  type="password"
                  value={deleteAllPassword}
                  onChange={(event) => setDeleteAllPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="현재 관리자 비밀번호"
                  autoFocus
                  disabled={deletingAll}
                />
              </label>

              {deleteAllError && <div className="error-message">{deleteAllError}</div>}

              <div className="delete-all-actions">
                <button type="button" className="secondary-button" onClick={closeDeleteAll} disabled={deletingAll}>
                  취소
                </button>
                <button type="submit" className="danger-primary-button" disabled={deletingAll || questions.length === 0}>
                  {deletingAll ? "전체 삭제 중..." : `${questions.length}개 문제 전체 삭제`}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className="version-badge">{VERSION}</div>
    </main>
  );
}

export default App;
