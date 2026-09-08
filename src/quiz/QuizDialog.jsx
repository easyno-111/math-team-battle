import { useEffect, useRef } from 'react';

export default function QuizDialog({ title, onClose, children, className = '' }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialogRef} className={`qm-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="qm-section-head qm-dialog-heading"><h3>{title}</h3><button type="button" onClick={onClose} aria-label={`${title} 닫기`}>닫기 <span aria-hidden="true">×</span></button></div>
    {children}
  </dialog>;
}
