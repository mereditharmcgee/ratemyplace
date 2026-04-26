import { useState } from 'react';

interface ContactFormProps {
  turnstileSitekey?: string;
}

export function ContactForm({ turnstileSitekey = '0x4AAAAAACo4KpkxsacPhM2r' }: ContactFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateForm = (name: string, email: string, message: string): boolean => {
    const errors: Record<string, string> = {};

    if (!name || name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters.';
    } else if (name.trim().length > 100) {
      errors.name = 'Name must be under 100 characters.';
    }

    if (!email || !email.includes('@')) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!message || message.trim().length < 10) {
      errors.message = 'Message must be at least 10 characters.';
    } else if (message.trim().length > 3000) {
      errors.message = 'Message must be under 3000 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const message = formData.get('message') as string;

    if (!validateForm(name, email, message)) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setSubmitted(true);
      } else if (response.status === 429) {
        setError('Too many submissions. Please wait an hour before trying again.');
      } else {
        setError(result.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="flex gap-3">
          <svg className="w-6 h-6 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="font-semibold text-green-800 text-lg">Message sent!</p>
            <p className="text-green-700 mt-1">
              Thank you for reaching out. We've received your message and sent a confirmation to your email.
              We aim to respond within 2-3 business days.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const inputClass = "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-teal-500 focus:border-teal-500";
  const errorInputClass = "mt-1 block w-full px-3 py-2 border border-red-400 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-red-500 focus:border-red-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          className={fieldErrors.name ? errorInputClass : inputClass}
        />
        {fieldErrors.name && (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.name}</p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email <span className="text-red-500">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={fieldErrors.email ? errorInputClass : inputClass}
        />
        {fieldErrors.email && (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.email}</p>
        )}
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700">
          Category
        </label>
        <select
          id="category"
          name="category"
          className={inputClass}
        >
          <option value="general">General inquiry</option>
          <option value="privacy">Privacy concern</option>
          <option value="support">Support request</option>
          <option value="landlord">Landlord / property manager</option>
        </select>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          minLength={10}
          maxLength={3000}
          placeholder="How can we help you?"
          className={fieldErrors.message ? errorInputClass : inputClass}
        />
        {fieldErrors.message && (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.message}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">At least 10 characters, max 3000.</p>
      </div>

      {/* Turnstile widget */}
      <div className="cf-turnstile" data-sitekey={turnstileSitekey} data-theme="light" />

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-[4px] shadow-sm text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}
