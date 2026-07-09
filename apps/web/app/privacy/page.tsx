import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Moodboard",
  description: "Privacy policy for the Moodboard personal creative reference tool.",
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  const updated = "June 8, 2026";

  return (
    <div className="min-h-screen bg-white text-gray-900 px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: {updated}</p>

        <section className="space-y-8 text-sm leading-relaxed text-gray-700">

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Overview</h2>
            <p>
              Moodboard (<strong>moodboard.leotix.fr</strong>) is a personal, single-user creative
              reference tool. It is not a public service and is not intended for use by the general
              public. No personal data from third parties is collected, stored, or shared.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. Instagram Integration</h2>
            <p>
              Moodboard uses the Instagram oEmbed API solely to retrieve publicly available
              post metadata (thumbnail image, caption, author name) from public Instagram posts
              whose URLs are manually submitted by the owner of this application.
            </p>
            <ul className="list-disc list-inside mt-3 space-y-1">
              <li>No Instagram user login or OAuth flow is implemented.</li>
              <li>No Instagram user data is stored in our database.</li>
              <li>Only the public image and caption of the submitted post URL are fetched.</li>
              <li>The fetched image is stored privately in the owner&apos;s personal Cloudflare R2 storage.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. Data We Collect</h2>
            <p>
              As a single-user personal tool, the only data collected and stored is content
              deliberately added by the sole owner of this application (images, titles, tags,
              notes). No analytics, tracking, or third-party cookies are used.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Data Sharing</h2>
            <p>
              No data is sold, rented, or shared with any third party. Image storage uses
              Cloudflare R2, governed by its privacy policy.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Data Deletion</h2>
            <p>
              Since this application stores no personal data from third-party Instagram users,
              there is no Instagram user data to delete. If you believe your content has been
              incorrectly stored, please contact:
            </p>
            <p className="mt-2 font-medium">
              <a href="mailto:hello@leotix.fr" className="text-blue-600 underline">
                hello@leotix.fr
              </a>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. Security</h2>
            <p>
              Access to this application is protected by authentication. The application is
              hosted on Vercel with HTTPS enforced at all times.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. Contact</h2>
            <p>
              For any privacy-related question or request, contact:{" "}
              <a href="mailto:hello@leotix.fr" className="text-blue-600 underline">
                hello@leotix.fr
              </a>
            </p>
          </div>

        </section>
      </div>
    </div>
  );
}
