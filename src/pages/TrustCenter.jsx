import {
  Shield,
  FileText,
  Lock,
  Database,
  Mail,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/**
 * TrustCenter
 *
 * Read-only Trust & Security page for Atlas Command.
 *
 * Purpose:
 * - Give users a clear place INSIDE the app to see:
 *   - Security practices summary
 *   - Links to Privacy Policy & Terms of Service
 *   - Backup & data protection overview
 *   - How to contact you about security/privacy
 *
 * IMPORTANT:
 * - This page does NOT change any security behavior.
 * - No RLS, auth, or permissions are touched.
 * - Purely informational UI.
 */
export default function TrustCenter() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <section className="flex flex-col gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 w-fit">
          <Shield className="h-4 w-4" />
          <span>Atlas Command · Trust &amp; Security</span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-slate-50">
            Trust &amp; Security Center
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            This page gives you a human-readable overview of how Atlas Command
            protects your data, plus direct links to our public Security,
            Privacy Policy, and Terms of Service pages.
          </p>
        </div>
      </section>

      {/* Main grid */}
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {/* Security Practices */}
        <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Security Practices
                </h2>
                <p className="text-xs text-slate-400">
                  How Atlas Command protects your data.
                </p>
              </div>
            </div>
          </div>

          <ul className="mb-4 space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
              <span>
                <strong>Encryption:</strong> TLS&nbsp;1.3 in transit, AES-256 at
                rest.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
              <span>
                <strong>Access control:</strong> Database-level Row Level
                Security (RLS), MFA, and role-based permissions.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
              <span>
                <strong>Infrastructure:</strong> Built on Supabase and Vercel,
                both SOC&nbsp;2 Type II compliant.
              </span>
            </li>
          </ul>

          <a
            href="/security"
            className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:text-emerald-200"
          >
            View full Security Practices
            <ExternalLink className="h-3 w-3" />
          </a>
        </article>

        {/* Privacy Policy */}
        <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10">
                <FileText className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Privacy Policy
                </h2>
                <p className="text-xs text-slate-400">
                  How we collect, use, and protect personal data.
                </p>
              </div>
            </div>
          </div>

          <ul className="mb-4 space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-400" />
              <span>
                You retain ownership of your data (loads, drivers, trucks,
                customers, documents).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-400" />
              <span>
                Data is processed to operate Atlas Command and improve the
                product&mdash;not sold to third parties.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-400" />
              <span>
                AI (OpenAI) processes documents and queries, but your data is{" "}
                <strong>not used to train</strong> their models.
              </span>
            </li>
          </ul>

          <a
            href="/privacy"
            className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200"
          >
            View Privacy Policy
            <ExternalLink className="h-3 w-3" />
          </a>
        </article>

        {/* Terms of Service */}
        <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/30">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10">
                <Lock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Terms of Service
                </h2>
                <p className="text-xs text-slate-400">
                  The rules for using Atlas Command (beta).
                </p>
              </div>
            </div>
          </div>

          <ul className="mb-4 space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-amber-400" />
              <span>
                Atlas Command is currently in <strong>beta</strong>; features
                may change and downtime can occur.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-amber-400" />
              <span>
                You own your operational data; we provide the platform to host
                and process it.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
              <span>
                AI outputs (dispatch suggestions, document parsing) are
                assistance, and should be verified before critical decisions.
              </span>
            </li>
          </ul>

          <a
            href="/terms-of-service"
            className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200"
          >
            View Terms of Service
            <ExternalLink className="h-3 w-3" />
          </a>
        </article>

        {/* Data Protection & Backups */}
        <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/30 md:col-span-2 xl:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10">
                <Database className="h-5 w-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Data Protection &amp; Backups
                </h2>
                <p className="text-xs text-slate-400">
                  How we keep your data durable and recoverable.
                </p>
              </div>
            </div>
          </div>

          <ul className="mb-4 space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-indigo-400" />
              <span>
                Automated database backups through Supabase, plus additional
                manual backup scripts for Atlas.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-indigo-400" />
              <span>
                Disaster recovery procedures documented for accidental deletion,
                corruption, or infrastructure issues.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-indigo-400" />
              <span>
                You can request data export in standard formats (JSON/CSV) at
                any time.
              </span>
            </li>
          </ul>

          <p className="mt-auto text-[11px] text-slate-500">
            Detailed backup and recovery procedures are documented internally in
            the Atlas Command Backup Setup Guide. This summary is provided for
            transparency; it does not replace your own backup responsibilities.
          </p>
        </article>

        {/* Contact & Questions */}
        <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/30 md:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-700/60">
                <Mail className="h-5 w-5 text-slate-100" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-50">
                  Questions, Incidents, or Requests
                </h2>
                <p className="text-xs text-slate-400">
                  How to reach us about security, privacy, or general support.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 text-xs text-slate-300 md:grid-cols-3">
            <div className="space-y-1">
              <p className="font-medium text-slate-100">Security</p>
              <p className="text-slate-400">
                For vulnerability reports, suspicious activity, or security
                questions:
              </p>
              <a
                href="mailto:security@atlascommand.com"
                className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:text-emerald-200"
              >
                security@atlascommand.com
              </a>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-slate-100">Privacy</p>
              <p className="text-slate-400">
                For data access, deletion, or privacy rights requests:
              </p>
              <a
                href="mailto:privacy@atlascommand.com"
                className="inline-flex items-center gap-1 font-medium text-sky-300 hover:text-sky-200"
              >
                privacy@atlascommand.com
              </a>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-slate-100">Support</p>
              <p className="text-slate-400">
                For general product support, questions, or bug reports:
              </p>
              <a
                href="mailto:support@atlascommand.com"
                className="inline-flex items-center gap-1 font-medium text-indigo-300 hover:text-indigo-200"
              >
                support@atlascommand.com
              </a>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-slate-500">
            Atlas Command is currently in{" "}
            <span className="font-semibold text-slate-300">beta</span>. As we
            grow, this page will expand with additional certifications (e.g.,
            SOC&nbsp;2) and security program details.
          </p>
        </article>
      </section>
    </div>
  );
}
