import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function RoomQrCode({ joinUrl, roomCode, onOpenLarge }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!joinUrl) return undefined;

    QRCode.toDataURL(joinUrl, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#4e4663",
        light: "#fffaf4",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setError("");
        }
      })
      .catch((qrError) => {
        console.error("QR 코드 생성 오류:", qrError);
        if (!cancelled) setError("QR 코드를 만들지 못했어요.");
      });

    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  return (
    <div className="room-qr-card">
      <button
        type="button"
        className="room-qr-image-button"
        onClick={() => qrDataUrl && onOpenLarge?.(qrDataUrl)}
        aria-label="QR 코드 크게 보기"
      >
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`방 코드 ${roomCode} 학생 입장 QR 코드`} />
        ) : (
          <span className="qr-loading-placeholder">QR</span>
        )}
      </button>
      <div className="room-qr-copy">
        <span>휴대폰으로 바로 입장</span>
        <strong>QR 찍고 이름만 입력</strong>
        {error && <small>{error}</small>}
      </div>
    </div>
  );
}
