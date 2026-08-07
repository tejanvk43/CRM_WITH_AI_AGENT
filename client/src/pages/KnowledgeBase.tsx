import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, FileText, CalendarDays, Tag, ChevronRight } from "lucide-react";

const FILE_META: Record<string, { title: string; desc: string }> = {
  product_terms: {
    title: "Product Terms",
    desc: "FlexiPay pay-in-3 pricing, eligibility, fees, repayment rules and compliance statements.",
  },
  kyc_process: {
    title: "KYC & Onboarding",
    desc: "RBI/DPDP regulatory basis, required documents, 7-step onboarding journey, consent rules.",
  },
  faq_objections: {
    title: "FAQ & Objections",
    desc: "6 FAQs plus 5 approved objection-handling responses and escalation guardrails.",
  },
};

export default function KnowledgeBase() {
  const documents = trpc.copilot.documents.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const chunksQuery = trpc.copilot.chunks.useQuery(
    { source_file: selected ?? "" },
    { enabled: !!selected },
  );

  const selectedMeta = FILE_META[selected?.replace(/\.md$/, "") ?? ""] ?? null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The three indexed source-of-truth documents, chunked at ~500 tokens with 50-token
          overlap. Every chunk carries version and updated-at metadata for the accuracy guardrail.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {documents.isLoading &&
          [0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        {documents.data?.map((doc) => (
          <Card
            key={doc.source_file}
            className={`cursor-pointer transition-all hover:border-primary/50 ${
              selected === doc.source_file ? "border-primary ring-1 ring-primary/40" : ""
            }`}
            onClick={() =>
              setSelected(selected === doc.source_file ? null : doc.source_file)
            }
          >
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">{doc.source_file}</h3>
                </div>
                <Badge variant="secondary" className="text-xs">
                  v{doc.version}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {FILE_META[doc.source_file.replace(/\.md$/, "")]?.desc ?? doc.source_file}
              </p>
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {doc.updated_at}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" /> {doc.chunk_count} chunks
                </span>
                <ChevronRight
                  className={`h-4 w-4 ml-auto transition-transform ${
                    selected === doc.source_file ? "rotate-90" : ""
                  }`}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chunk drill-down */}
      {selected && (
        <Card className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              {selectedMeta?.title ?? selected} — raw chunks
              <Badge variant="outline" className="text-xs font-normal">
                v{documents.data?.find((d) => d.source_file === selected)?.version}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chunksQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : (
              <ScrollArea className="max-h-[480px]">
                <div className="space-y-3 pr-4">
                  {chunksQuery.data?.map((chunk) => (
                    <div key={chunk.id} className="rounded-lg border bg-secondary/30 p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {chunk.id}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          § {chunk.section}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          updated {chunk.updated_at}
                        </span>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap text-foreground/85 font-sans">
                        {chunk.text}
                      </pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
