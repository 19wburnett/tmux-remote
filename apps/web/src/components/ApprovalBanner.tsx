import { useApp } from '../provider';
import { IconAlert } from './icons';

export function ApprovalBanner({ sessionId }: { sessionId: string }) {
  const { approvals, approve, setNotice } = useApp();
  const req = approvals.find((a) => a.sessionId === sessionId);
  if (!req) return null;

  return (
    <div className="approval-banner">
      <div className="title">
        <IconAlert width={15} height={15} /> {req.title}
      </div>
      {req.detail && <div className="detail">{req.detail}</div>}
      <div className="actions">
        <button
          className="btn approve"
          onClick={() => {
            void approve(true);
            setNotice('Approved — response sent');
          }}
        >
          Approve
        </button>
        <button
          className="btn reject"
          onClick={() => {
            void approve(false);
            setNotice('Rejected — response sent');
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
