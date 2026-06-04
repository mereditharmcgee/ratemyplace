import { useState } from 'react';

interface SettingsTabProps {
  userName: string | null;
  userEmail: string;
  hasPassword: boolean;
  isGoogleUser: boolean;
  notificationOptIn: boolean;
}

type MessageState = { type: 'success' | 'error'; text: string } | null;

export default function SettingsTab({
  userName,
  userEmail,
  hasPassword,
  isGoogleUser,
  notificationOptIn,
}: SettingsTabProps) {
  // Display name section
  const [displayName, setDisplayName] = useState(userName || '');
  const [nameLoading, setNameLoading] = useState(false);
  const [nameMessage, setNameMessage] = useState<MessageState>(null);

  // Notification preferences section
  const [notifEnabled, setNotifEnabled] = useState(notificationOptIn);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifMessage, setNotifMessage] = useState<MessageState>(null);

  // Password section
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<MessageState>(null);

  // Email section
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMessage, setEmailMessage] = useState<MessageState>(null);

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameLoading(true);
    setNameMessage(null);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json();
      if (res.ok) {
        setNameMessage({ type: 'success', text: 'Display name updated.' });
      } else {
        setNameMessage({ type: 'error', text: data.error || 'Failed to update display name.' });
      }
    } catch {
      setNameMessage({ type: 'error', text: 'An error occurred.' });
    } finally {
      setNameLoading(false);
    }
  };

  const handleNotifSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotifLoading(true);
    setNotifMessage(null);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationOptIn: notifEnabled }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotifMessage({ type: 'success', text: 'Notification preferences saved.' });
      } else {
        setNotifMessage({ type: 'error', text: data.error || 'Failed to save preferences.' });
      }
    } catch {
      setNotifMessage({ type: 'error', text: 'An error occurred.' });
    } finally {
      setNotifLoading(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    setPasswordMessage(null);
    try {
      const body: { newPassword: string; currentPassword?: string } = { newPassword };
      if (hasPassword) {
        body.currentPassword = currentPassword;
      }
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMessage({ type: 'success', text: data.message || 'Password updated.' });
        setCurrentPassword('');
        setNewPassword('');
        // If sessions were invalidated, redirect to sign in
        if (data.message?.includes('sign in again')) {
          setTimeout(() => {
            window.location.href = '/auth/signin';
          }, 2000);
        }
      } else {
        setPasswordMessage({ type: 'error', text: data.error || 'Failed to update password.' });
      }
    } catch {
      setPasswordMessage({ type: 'error', text: 'An error occurred.' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleEmailSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    setEmailMessage(null);
    try {
      const res = await fetch('/api/user/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: emailCurrentPassword, newEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmailMessage({ type: 'success', text: data.message || 'Email updated.' });
        setEmailCurrentPassword('');
        setNewEmail('');
      } else {
        setEmailMessage({ type: 'error', text: data.error || 'Failed to update email.' });
      }
    } catch {
      setEmailMessage({ type: 'error', text: 'An error occurred.' });
    } finally {
      setEmailLoading(false);
    }
  };

  const sectionClass = 'bg-white rounded-[6px] border border-gray-200 p-6';

  const renderMessage = (msg: MessageState) => {
    if (!msg) return null;
    return (
      <p className={`mt-3 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-700'}`}>
        {msg.text}
      </p>
    );
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Display Name */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Display Name</h3>
        <form onSubmit={handleNameSave}>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Name shown on your reviews
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            placeholder="Your name (optional)"
            className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
          <p className="mt-1 text-xs text-gray-500">Leave blank to remain anonymous on your reviews.</p>
          <button
            type="submit"
            disabled={nameLoading}
            className="mt-3 px-4 py-2 bg-teal-700 text-white font-semibold text-sm rounded-[4px] hover:bg-teal-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nameLoading ? 'Saving...' : 'Save Name'}
          </button>
          {renderMessage(nameMessage)}
        </form>
      </div>

      <hr className="border-gray-200" />

      {/* Section 2: Notification Preferences */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h3>
        <form onSubmit={handleNotifSave}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifEnabled}
              onChange={(e) => setNotifEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 text-teal-700 border-gray-300 rounded focus:ring-teal-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Email me when my review status changes
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Email notifications coming soon — your preference will be applied when enabled.
              </p>
            </div>
          </label>
          <button
            type="submit"
            disabled={notifLoading}
            className="mt-4 px-4 py-2 bg-teal-700 text-white font-semibold text-sm rounded-[4px] hover:bg-teal-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {notifLoading ? 'Saving...' : 'Save Preferences'}
          </button>
          {renderMessage(notifMessage)}
        </form>
      </div>

      <hr className="border-gray-200" />

      {/* Section 3: Password */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {hasPassword ? 'Change Password' : 'Set Password'}
        </h3>
        {!hasPassword && isGoogleUser && (
          <p className="text-sm text-gray-600 mb-4">
            You signed in with Google. Set a password to also sign in with email.
          </p>
        )}
        <form onSubmit={handlePasswordSave} className="space-y-3 max-w-sm">
          {hasPassword && (
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          )}
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
              {hasPassword ? 'New Password' : 'Password'}
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            <p className="mt-1 text-xs text-gray-500">Minimum 8 characters.</p>
          </div>
          <button
            type="submit"
            disabled={passwordLoading}
            className="px-4 py-2 bg-teal-700 text-white font-semibold text-sm rounded-[4px] hover:bg-teal-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {passwordLoading ? 'Saving...' : hasPassword ? 'Change Password' : 'Set Password'}
          </button>
          {renderMessage(passwordMessage)}
        </form>
      </div>

      <hr className="border-gray-200" />

      {/* Section 4: Email */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Address</h3>
        {isGoogleUser ? (
          <div>
            <p className="text-sm text-gray-700 mb-1">
              Current email: <span className="font-medium">{userEmail}</span>
            </p>
            <p className="text-sm text-gray-500">
              Email is managed through your Google account and cannot be changed here.
            </p>
          </div>
        ) : (
          <form onSubmit={handleEmailSave} className="space-y-3 max-w-sm">
            <div>
              <label htmlFor="emailCurrentPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Current Password
              </label>
              <input
                id="emailCurrentPassword"
                type="password"
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label htmlFor="newEmail" className="block text-sm font-medium text-gray-700 mb-1">
                New Email Address
              </label>
              <input
                id="newEmail"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <button
              type="submit"
              disabled={emailLoading}
              className="px-4 py-2 bg-teal-700 text-white font-semibold text-sm rounded-[4px] hover:bg-teal-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {emailLoading ? 'Saving...' : 'Change Email'}
            </button>
            {renderMessage(emailMessage)}
          </form>
        )}
      </div>
    </div>
  );
}
