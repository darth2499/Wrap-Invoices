// Shows the email exactly as the client will get it (same template the server sends).
import { useEffect, useRef, useState } from 'react';

export default function EmailPreview({ html, label = 'Preview' }) {
  const ref = useRef(null);
  const [h, setH] = useState(520);
  useEffect(() => {
    const f = ref.current;
    if (!f) return undefined;
    const fit = () => { try { setH(Math.max(320, f.contentDocument.documentElement.scrollHeight)); } catch { /* sandboxed */ } };
    f.addEventListener('load', fit);
    return () => f.removeEventListener('load', fit);
  }, []);
  return (
    <div className="col" style={{ gap: 6, minWidth: 0 }}>
      <span className="small muted">{label}</span>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#f6f6f4' }}>
        <iframe ref={ref} title="Email preview" srcDoc={html} sandbox="allow-same-origin allow-popups" style={{ width: '100%', height: h, border: 0, display: 'block' }} />
      </div>
    </div>
  );
}
