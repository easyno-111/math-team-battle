const AI_REQUEST_LOG_KEY = "math-team-battle:ai-request-log";

const DEFAULT_LIMITS = {
  perMinute: 5,
  perDay: 60,
};

function readLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AI_REQUEST_LOG_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => Number.isFinite(Number(value))).map(Number);
  } catch {
    return [];
  }
}

function writeLog(log) {
  try {
    localStorage.setItem(AI_REQUEST_LOG_KEY, JSON.stringify(log));
  } catch {
    // localStorage를 사용할 수 없는 환경에서는 보호 기능만 건너뛴다.
  }
}

export function checkAndRecordAiRequest(limits = DEFAULT_LIMITS) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const recent = readLog().filter((time) => time >= oneDayAgo);
  const minuteCount = recent.filter((time) => time >= oneMinuteAgo).length;

  if (minuteCount >= limits.perMinute) {
    const error = new Error(`이 브라우저에서 AI 요청을 너무 빠르게 보내고 있습니다. 1분에 최대 ${limits.perMinute}회까지 허용합니다.`);
    error.code = "CLIENT_AI_RATE_LIMIT";
    throw error;
  }

  if (recent.length >= limits.perDay) {
    const error = new Error(`이 브라우저의 오늘 AI 요청 보호 한도(${limits.perDay}회)에 도달했습니다. 이 제한은 실수로 연속 호출하는 것을 막기 위한 장치입니다.`);
    error.code = "CLIENT_AI_RATE_LIMIT";
    throw error;
  }

  recent.push(now);
  writeLog(recent);

  return {
    remainingMinute: Math.max(0, limits.perMinute - minuteCount - 1),
    remainingDay: Math.max(0, limits.perDay - recent.length),
  };
}

export function isClientAiRateLimitError(error) {
  return error?.code === "CLIENT_AI_RATE_LIMIT";
}

export function clearClientAiRequestLog() {
  try {
    localStorage.removeItem(AI_REQUEST_LOG_KEY);
  } catch {
    // 무시
  }
}
