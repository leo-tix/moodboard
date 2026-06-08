import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion — Moodboard",
  description: "How to request deletion of your data from Moodboard.",
  robots: { index: false, follow: false },
};

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-2">Data Deletion Request</h1>
        <p className="text-sm text-gray-500 mb-10">Moodboard — moodboard.leotix.fr</p>

        <div className="space-y-6 text-sm leading-relaxed text-gray-700">

          <p>
            Moodboard is a personal, single-user tool. It does not collect or store any
            personal data from Instagram users. The application only accesses publicly
            available post information (image, caption) via the official Instagram oEmbed
            API, and no Instagram account login is required.
          </p>

          <p>
            If you believe any of your data has been stored by this application and wish
            to request its deletion, please send an email to:
          </p>

          <p className="text-lg font-medium">
            <a href="mailto:hello@leotix.fr" className="text-blue-600 underline">
              hello@leotix.fr
            </a>
          </p>

          <p>
            Include the URL of the Instagram post in question. Any associated data will
            be permanently deleted within 30 days of your request.
          </p>

        </div>
      </div>
    </div>
  );
}
