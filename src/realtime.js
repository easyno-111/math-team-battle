import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  getAuth,
  setPersistence,
} from "firebase/auth";
import { getDatabase } from "firebase/database";

const databaseURL = (import.meta.env.VITE_FIREBASE_DATABASE_URL || "")
  .trim()
  .replace(/\/$/, "");

export const realtimeReady = Boolean(databaseURL);
export const realtimeDatabaseURL = databaseURL;

const defaultApp = getApp();

export const adminRealtime = realtimeReady
  ? getDatabase(defaultApp, databaseURL)
  : null;

const STUDENT_APP_NAME = "math-team-battle-student";
let studentApp = getApps().find((app) => app.name === STUDENT_APP_NAME);

if (!studentApp) {
  studentApp = initializeApp(
    {
      ...defaultApp.options,
      ...(databaseURL ? { databaseURL } : {}),
    },
    STUDENT_APP_NAME
  );
}

export const studentAuth = getAuth(studentApp);
export const studentRealtime = realtimeReady
  ? getDatabase(studentApp, databaseURL)
  : null;

// 교사 로그인과 학생 익명 로그인이 같은 브라우저에서도 서로 영향을 주지 않도록
// 학생 전용 Firebase App을 따로 사용한다.
export async function prepareStudentAuthPersistence() {
  await setPersistence(studentAuth, browserSessionPersistence);
}
