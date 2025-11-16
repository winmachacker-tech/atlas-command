// FILE: src/pages/PrivacyPolicy.jsx
// Purpose: Public-facing Privacy Policy for Atlas Command (beta)
//
// This is NOT a replacement for real legal review, but gives you a clear,
// human-readable policy you can iterate on and have a lawyer tighten later.

import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ShieldCheck,
  UserRound,
  Database,
  Lock,
  Trash2,
  Globe2,
  FileText,
} from "lucide-react";

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#050816] text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8 lg:py-10">
        {/* Back + badge */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Atlas Command • Privacy Policy</span>
          </div>
        </div>

        {/* Heading */}
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            This Privacy Policy explains how Atlas Command (&quot;we&quot;,
            &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects
            information when you use the Atlas Command platform and related
            services.
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
            Status: Draft for beta testing – subject to change as the product
            evolves.
          </p>
        </header>

        {/* Section: What we collect */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800/80">
              <UserRound className="h-5 w-5 text-slate-100" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                1. Information we collect
              </h2>
              <p className="text-xs text-slate-400">
                We collect only the information needed to run the product and
                support your operations.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="font-medium">Account information.</span> Name,
              email address, and authentication details provided when users sign
              up or are invited to Atlas Command.
            </li>
            <li>
              <span className="font-medium">Operational data.</span> Freight and
              dispatch information you choose to store in Atlas Command, such as
              loads, customers, drivers, trucks, documents, and notes.
            </li>
            <li>
              <span className="font-medium">Usage and log data.</span>{" "}
              Application logs, audit events, and technical metadata (such as
              timestamps and IP addresses) used for security, abuse prevention,
              and product improvement.
            </li>
            <li>
              <span className="font-medium">Support communications.</span> Any
              information you provide when you contact us for support, feedback,
              or onboarding.
            </li>
          </ul>
        </section>

        {/* Section: How we use data */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15">
              <FileText className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                2. How we use your data
              </h2>
              <p className="text-xs text-slate-400">
                We use your data to operate Atlas Command, improve the product,
                and keep the platform secure.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>To provide the core TMS and dispatch functions you request.</li>
            <li>To secure accounts, prevent abuse, and investigate incidents.</li>
            <li>To monitor reliability, performance, and error rates.</li>
            <li>
              To build non-identifying analytics that help improve workflows and
              product decisions.
            </li>
          </ul>

          <p className="mt-3 text-[11px] text-slate-500">
            We do <span className="font-semibold">not</span> sell your personal
            data to third parties.
          </p>
        </section>

        {/* Section: Data ownership & AI */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15">
              <Database className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                3. Data ownership & AI processing
              </h2>
              <p className="text-xs text-slate-400">
                You own your operational data. AI features work on your behalf,
                using that data to help you make decisions.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="font-medium">You retain ownership.</span> Loads,
              drivers, trucks, documents, and related operational data belong to
              you (or your organization), not Atlas Command.
            </li>
            <li>
              <span className="font-medium">We act as a processor.</span> We
              process and store data only to provide the Atlas Command service
              and related features.
            </li>
            <li>
              <span className="font-medium">AI features.</span> When you use AI
              features (dispatch suggestions, document parsing, etc.), relevant
              data is sent securely to AI providers such as OpenAI via API.
              Those providers do <span className="font-semibold">not</span> use
              API data to train their public models.
            </li>
            <li>
              <span className="font-medium">Aggregated insights.</span> We may
              create aggregated or anonymized statistics (for example, general
              performance metrics) that do not identify you or your customers.
            </li>
          </ul>
        </section>

        {/* Section: Security & retention */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15">
              <Lock className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                4. Security & data retention
              </h2>
              <p className="text-xs text-slate-400">
                Security is built into the platform from day one.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="font-medium">Access control.</span> We rely on
              database Row Level Security (RLS), strong authentication, and MFA
              to keep organizations separated.
            </li>
            <li>
              <span className="font-medium">Encryption.</span> Data is
              encrypted in transit (HTTPS/TLS). Storage encryption is inherited
              from the underlying cloud providers (for example, Supabase and
              Vercel).
            </li>
            <li>
              <span className="font-medium">Backups.</span> Atlas Command runs
              on managed Postgres with automated backups and point-in-time
              recovery capabilities provided by the hosting platform.
            </li>
            <li>
              <span className="font-medium">Retention.</span> We retain data as
              long as your account or organization remains active, or as needed
              to comply with legal obligations and resolve disputes. We may
              retain security logs for a longer period for audit and abuse
              prevention.
            </li>
          </ul>
        </section>

        {/* Section: Your choices & rights */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15">
              <Trash2 className="h-5 w-5 text-rose-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                5. Your choices & data requests
              </h2>
              <p className="text-xs text-slate-400">
                You can contact us at any time regarding your data.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="font-medium">Access & export.</span> You can
              request a copy of your data in a reasonable, exportable format
              (for example, CSV or JSON) by contacting support.
            </li>
            <li>
              <span className="font-medium">Correction.</span> If you believe
              certain information is inaccurate or incomplete, you can request a
              correction.
            </li>
            <li>
              <span className="font-medium">Deletion.</span> You may request
              deletion of specific data, or closure of your account, subject to
              any legal or operational requirements to retain certain records
              (for example, billing and security logs).
            </li>
          </ul>
        </section>

        {/* Section: International & changes */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/15">
              <Globe2 className="h-5 w-5 text-purple-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-50">
                6. International use & policy changes
              </h2>
              <p className="text-xs text-slate-400">
                Atlas Command is currently an early-stage product and may not be
                appropriate for all regulatory environments yet.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              <span className="font-medium">Regional requirements.</span> If
              your organization is subject to specific regulations (for example,
              GDPR, HIPAA, or industry-specific rules), you are responsible for
              assessing whether Atlas Command meets those requirements.
            </li>
            <li>
              <span className="font-medium">Policy updates.</span> We may update
              this Privacy Policy as the product and infrastructure evolve. When
              we do, we will update the &quot;last updated&quot; date and may
              provide additional notice in the app.
            </li>
          </ul>
        </section>

        {/* Section: Contact */}
        <section className="mb-10 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-5">
          <h2 className="text-sm font-semibold text-slate-50">
            7. Contact us
          </h2>
          <p className="mt-2 text-xs text-slate-300">
            If you have questions about this Privacy Policy or how we handle
            data, contact:
          </p>
          <div className="mt-3 grid gap-3 text-xs text-slate-200 md:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Security
              </p>
              <a
                href="mailto:security@atlascommand.com"
                className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
              >
                security@atlascommand.com
              </a>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Privacy
              </p>
              <a
                href="mailto:privacy@atlascommand.com"
                className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
              >
                privacy@atlascommand.com
              </a>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Support
              </p>
              <a
                href="mailto:support@atlascommand.com"
                className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
              >
                support@atlascommand.com
              </a>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-slate-500">
            Last updated:{" "}
            <span className="font-medium">[Set a date before beta launch]</span>
          </p>
        </section>
      </div>
    </div>
  );
}
