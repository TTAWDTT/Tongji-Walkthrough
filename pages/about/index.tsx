import { Chip } from "@heroui/react";

import DefaultLayout from "@/layouts/default";

export default function DocsPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center justify-start gap-4 pt-2 pb-8 md:pt-2 md:pb-10">
        <div className="inline-block max-w-lg justify-center">
          <img
            alt="Tongji University"
            className="mx-auto h-auto w-40 md:w-56"
            height={224}
            src={`${basePath}/brand/home-title.png`}
            width={224}
          />
          <p className="mt-4 leading-8">
            <Chip color="accent">Tongji Walkthrough</Chip>
            是一个由同济学生维护的非官方指南。我们希望把那些散落在群聊、经验帖、口口相传里的信息，整理成一个更容易检索、也更容易持续更新的地方。这里会收集学习、生活、校园服务、课程、工具和常见问题等内容（不仅限于新生问题！）。这个项目不追求一次写完，也不假装给出唯一答案。它更像是一份不断生长的地图：如果你发现某处信息过时、遗漏，或者有更好的经验，欢迎通过
            GitHub 参与维护。
          </p>
        </div>
      </section>
    </DefaultLayout>
  );
}
