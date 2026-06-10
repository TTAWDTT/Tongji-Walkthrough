import { EditDocsLayout } from "@/components/edit-docs-layout";
import { getAllDocSources, type DocSourceItem } from "@/lib/docs";

export default function EditDocsPage({ docs }: { docs: DocSourceItem[] }) {
  return <EditDocsLayout docs={docs} />;
}

export const getStaticProps = async () => {
  return {
    props: {
      docs: getAllDocSources(),
    },
  };
};
