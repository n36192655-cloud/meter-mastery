import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, User, RefreshCw } from "lucide-react";
import { answerQuestion, type AiResponse } from "@/lib/ai-intent";
import { AiResponseRenderer } from "@/components/ai-response";
import { MizanAiIcon } from "@/components/mizan-ai-icon";
import { syncPending } from "@/lib/sync";
import { toast } from "sonner";

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [{ title: "ميزان الذكي" }] }),
  component: AssistantPage,
});

interface UserMsg { role: "user"; text: string }
interface AssistantMsg { role: "assistant"; response: AiResponse }
type Msg = UserMsg | AssistantMsg;

const SUGGESTIONS = [
  "استعلام عن مشترك",
  "تحليل الفاقد لهذا الشهر",
  "من دفع ومن لم يدفع؟",
  "استعلام عن التحصيل اليوم",
];

function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      response: {
        kind: "suggestions",
        text: "أهلاً بك في «ميزان الذكي» — مستشارك الرقمي لتحليل الشبكة واتخاذ القرارات. اختر تقريراً أو اطرح سؤالاً:",
        suggestions: SUGGESTIONS,
      },
    },
  ]);
  const [input, setInput] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages]);

  function send(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setTimeout(() => {
      const response = answerQuestion(trimmed);
      setMessages((m) => [...m, { role: "assistant", response }]);
    }, 150);
  }

  function refresh() {
    const { synced } = syncPending();
    setRefreshKey((k) => k + 1);
    // Re-run the last user question to refresh the last card
    const lastUser = [...messages].reverse().find((m) => m.role === "user") as UserMsg | undefined;
    if (lastUser) {
      const response = answerQuestion(lastUser.text);
      setMessages((m) => {
        const last = m[m.length - 1];
        if (last && last.role === "assistant") return [...m.slice(0, -1), { role: "assistant", response }];
        return [...m, { role: "assistant", response }];
      });
    }
    toast.success(synced > 0 ? `تمت مزامنة ${synced} إدخال معلّق` : "تم التحديث");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <MizanAiIcon size={32} /> ميزان الذكي
          </h1>
          <p className="text-sm text-muted-foreground mt-1">مستشار ميزان الرقمي — تحليل ذكي وقرارات فورية</p>
        </div>
      </div>

      <Card className="flex flex-col h-[70vh]" key={refreshKey}>
        <CardHeader className="border-b py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <MizanAiIcon size={18} /> مستشار ميزان الرقمي
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={refresh} title="تحديث ومزامنة">
            <RefreshCw className="w-4 h-4 ms-1" /> تحديث ومزامنة
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" ref={boxRef}>
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.role === "user" ? <User className="w-4 h-4" /> : <MizanAiIcon size={20} />}
              </div>
              <div className={`max-w-[90%] ${m.role === "user" ? "rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground" : "flex-1"}`}>
                {m.role === "user" ? m.text : <AiResponseRenderer response={m.response} onSuggestion={send} />}
              </div>
            </div>
          ))}
        </CardContent>
        <div className="border-t p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="text-xs px-2.5 py-1 rounded-full border hover:bg-primary/10 hover:border-primary/40 transition-colors">
                {s}
              </button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب سؤالك بالعربية…" />
            <Button type="submit" size="icon"><Send className="w-4 h-4" /></Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
