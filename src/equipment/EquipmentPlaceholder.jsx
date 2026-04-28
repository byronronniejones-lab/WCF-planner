// Phase 2 Round 8: inline `equipmentHome` view lifted out of main.jsx App().
// Trivial stub — "coming soon" card + back-to-home button. Matches the
// prop signature used by every other extracted view (Header + UsersModal
// wiring threaded through).
import React from 'react';
import UsersModal from '../auth/UsersModal.jsx';

export default function EquipmentPlaceholder({
  sb,
  Header,
  authState,
  setView,
  showUsers,
  setShowUsers,
  allUsers,
  setAllUsers,
  loadUsers,
}) {
  return (
    <div style={{minHeight: '100vh', background: '#f1f3f2'}}>
      {showUsers && (
        <UsersModal
          sb={sb}
          authState={authState}
          allUsers={allUsers}
          setAllUsers={setAllUsers}
          setShowUsers={setShowUsers}
          loadUsers={loadUsers}
        />
      )}
      <Header />
      <div style={{padding: '1.25rem', maxWidth: 1200, margin: '0 auto'}}>
        <div
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <div style={{fontSize: 48, marginBottom: 12}}>{'\ud83d\ude9c'}</div>
          <div style={{fontSize: 18, fontWeight: 700, color: '#57534e', marginBottom: 6}}>Equipment Tracking</div>
          <div style={{fontSize: 13, color: '#6b7280', marginBottom: 18}}>
            Tractors, implements, maintenance schedules {'\u2014'} coming in a future build.
          </div>
          <button
            onClick={() => setView('home')}
            style={{
              padding: '8px 20px',
              borderRadius: 7,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#374151',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {'\u2190 Back to Home'}
          </button>
        </div>
      </div>
    </div>
  );
}
