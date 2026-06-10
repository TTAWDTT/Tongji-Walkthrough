import { siteConfig } from "@/config/site";
import { title, subtitle } from "@/components/primitives";
import { GithubIcon } from "@/components/icons";
import DefaultLayout from "@/layouts/default";
import { SmoothLink } from "@/components/smooth-link";

const maintainers = [
  {
    name: "TTAWDTT",
    href: "https://github.com/TTAWDTT",
    avatar: "https://github.com/TTAWDTT.png",
  },
  {
    name: "Zhengxi YU",
    href: "https://github.com/yzxoi",
    avatar: "https://github.com/yzxoi.png",
  },
  {
    name: "Zhuang Ziyi",
    href: "https://github.com/mathzhuang",
    avatar: "https://github.com/mathzhuang.png",
  },
];

export default function IndexPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center justify-center gap-4 py-0 md:py-0">
        <div className="inline-block max-w-xl text-center justify-center">
          <span className={title()}>Tongji&nbsp;</span>
          <span className={title({ color: "blue" })}>Walkthrough&nbsp;</span>
          <br />
          <span className={title()}>
            for study, campus, and everyday orientation.
          </span>
          <div className={subtitle({ class: "mt-4" })}>愿同济的荣光永护您</div>
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

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm text-muted">
          <span>Maintainer:</span>
          <div className="flex items-center gap-2">
            {maintainers.map((maintainer) => (
              <a
                key={maintainer.href}
                aria-label={`${maintainer.name} on GitHub`}
                className="maintainer-avatar-link"
                href={maintainer.href}
                rel="noopener noreferrer"
                target="_blank"
                title={maintainer.name}
              >
                <img
                  alt=""
                  className="h-8 w-8 rounded-full"
                  height={32}
                  src={maintainer.avatar}
                  width={32}
                />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-4 max-w-2xl text-center text-muted leading-8">
          <img
            alt="Tongji University"
            className="mx-auto h-auto w-20 md:w-40"
            height={224}
            src={`${basePath}/brand/site-logo.png`}
            width={224}
          />
        </div>
      </section>
    </DefaultLayout>
  );
}
