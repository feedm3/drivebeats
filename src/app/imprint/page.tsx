import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Imprint",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ImprintPage() {
  return (
    <div className="overflow-y-auto px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-2xl font-bold text-foreground">Imprint</h1>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Information according to § 5 DDG
          </h2>
          <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
            <p>Fabian Dietenberger</p>
            <p>Gartenstraße 22</p>
            <p>88353 Kißlegg, Germany</p>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <div className="text-sm leading-relaxed text-muted-foreground">
            <p>
              Email:{" "}
              <a
                href="mailto:fabian@dietenberger.me"
                className="font-medium text-foreground hover:underline"
              >
                fabian@dietenberger.me
              </a>
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Responsible for content according to § 18 (2) MStV
          </h2>
          <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
            <p>Fabian Dietenberger</p>
            <p>Gartenstraße 22</p>
            <p>88353 Kißlegg, Germany</p>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Liability for content
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            As a service provider, I am responsible for my own content on these
            pages in accordance with § 7 (1) DDG. However, I am not obligated
            to monitor transmitted or stored third-party information or to
            investigate circumstances that indicate illegal activity.
            Obligations to remove or block the use of information under general
            law remain unaffected. Liability in this regard is only possible
            from the point in time at which I become aware of a specific
            infringement. Upon becoming aware of such violations, I will remove
            the content immediately.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Copyright</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The content and works published on this website are subject to
            German copyright law. Any use beyond the limits of copyright law
            requires the prior consent of the respective rights holder.
          </p>
        </div>
      </div>
    </div>
  );
}
