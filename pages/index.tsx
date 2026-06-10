import { siteConfig } from "@/config/site";
import { title, subtitle } from "@/components/primitives";
import { GithubIcon } from "@/components/icons";
import DefaultLayout from "@/layouts/default";
import { SmoothLink } from "@/components/smooth-link";

export default function IndexPage() {
  return (
    <DefaultLayout>
      <section className="flex flex-col items-center justify-center gap-4 py-8 md:py-12">
        <div className="inline-block max-w-xl text-center justify-center">
          <span className={title()}>Tongji&nbsp;</span>
          <span className={title({ color: "blue" })}>Walkthrough&nbsp;</span>
          <br />
          <span className={title()}>
            for study, campus, and everyday orientation.
          </span>
          <div className={subtitle({ class: "mt-4" })}>
            A quiet, structured guide that grows from Markdown notes.
          </div>
        </div>

        <div className="flex gap-3">
          <SmoothLink
            className="button button--primary button--md rounded-full"
            href={siteConfig.links.docs}
          >
            Docs
          </SmoothLink>
          <a
            className="button button--tertiary button--md rounded-full"
            href={siteConfig.links.github}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon size={20} />
            GitHub
          </a>
        </div>

        <div className="mt-8 max-w-2xl text-center text-muted leading-8">
          Edit Markdown files in{" "}
          <code className="rounded-sm bg-accent/20 px-2 py-1 font-mono text-sm text-accent">
            content/docs
          </code>{" "}
          and the Docs page will rebuild its sidebar automatically.
        </div>
      </section>
    </DefaultLayout>
  );
}
