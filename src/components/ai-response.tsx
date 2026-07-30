import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AiResponse } from "@/lib/ai-intent";
import { fmtYER, fmtNum } from "@/lib/pricing";
import { AlertTriangle, CheckCircle2, XCircle, Droplets, Zap, TrendingUp, Wallet, Smartphone, CircleDollarSign, User, Phone, MapPin, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

interface Props {
  response: AiResponse;
  onSuggestion: (q: string) => void;
}

export function AiResponseRenderer({ response, onSuggestion }: Props) {
  if (response.kind === "text" || response.kind === "suggestions") {
    return (
      <div className="space-y-2 text-sm whitespace-pre-wrap">
        <p>{response.text}</p>
        {response.suggestions && response.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {response.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-primary/10 hover:border-primary/40 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (response.kind === "subscriber_ledger") {
    const { customer, totals, series } = response;
    return (
      <Card className="border-primary/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold flex items-center gap-1.5"><User className="w-4 h-4 text-primary" /> {customer.name}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> <span dir="ltr">{customer.phone}</span></span>
                {customer.directorate && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {customer.directorate}</span>}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-1" dir="ltr">{customer.pay_account}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="إجمالي مفوتر" value={fmtYER(totals.billed)} />
            <StatBox label="مدفوع" value={fmtYER(totals.paid)} tone="ok" />
            <StatBox label="متأخرات" value={fmtYER(totals.arrears)} tone={totals.arrears > 0 ? "danger" : undefined} />
          </div>
          {series.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtNum(v)} />
                  <Bar dataKey="consumption" name="استهلاك" fill="var(--water)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (response.kind === "loss_analysis") {
    const chart = [
      { name: "مياه", produced: response.water.produced, consumed: response.water.consumed, loss: response.water.loss },
      { name: "كهرباء", produced: response.electric.produced, consumed: response.electric.consumed, loss: response.electric.loss },
    ];
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-xs text-muted-foreground">الفترة: {response.range.from} → {response.range.to}</div>
          <div className="grid grid-cols-2 gap-2">
            <LossCard label="فاقد المياه" pct={response.water.pct} loss={response.water.loss} icon={<Droplets className="w-4 h-4 text-water" />} />
            <LossCard label="فاقد الكهرباء" pct={response.electric.pct} loss={response.electric.loss} icon={<Zap className="w-4 h-4 text-electric" />} />
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtNum(v)} />
                <Legend />
                <Bar dataKey="produced" name="مُنتج" fill="var(--water)" />
                <Bar dataKey="consumed" name="مُستهلَك" fill="var(--electric-2)" />
                <Bar dataKey="loss" name="فاقد" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {response.alerts.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1">
              {response.alerts.map((a) => (
                <div key={a} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (response.kind === "payment_status") {
    function exportCsv(rows: Array<Record<string, string | number>>, name: string) {
      if (typeof window === "undefined") return;
      const cols = Object.keys(rows[0] ?? {});
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
    }
    return (
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="w-4 h-4" /> مدفوعة ({response.paid.length})</div>
              <Button size="sm" variant="ghost" onClick={() => exportCsv(response.paid, "paid")}><Download className="w-3 h-3 ms-1" /> CSV</Button>
            </div>
            <ul className="text-xs space-y-1 max-h-56 overflow-auto">
              {response.paid.map((p) => (
                <li key={p.id} className="flex justify-between border-b pb-1"><span className="font-mono text-[10px]">{p.serial}</span><span className="flex-1 mx-2 truncate">{p.name}</span><span className="font-semibold">{fmtYER(p.total)}</span></li>
              ))}
              {response.paid.length === 0 && <li className="text-muted-foreground text-center py-4">لا توجد</li>}
            </ul>
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold flex items-center gap-1.5 text-destructive"><XCircle className="w-4 h-4" /> غير مدفوعة ({response.unpaid.length})</div>
              <Button size="sm" variant="ghost" onClick={() => exportCsv(response.unpaid, "unpaid")}><Download className="w-3 h-3 ms-1" /> CSV</Button>
            </div>
            <ul className="text-xs space-y-1 max-h-56 overflow-auto">
              {response.unpaid.map((p) => (
                <li key={p.id} className="flex justify-between border-b pb-1"><span className="font-mono text-[10px]">{p.serial}</span><span className="flex-1 mx-2 truncate">{p.name}</span><span className="font-semibold">{fmtYER(p.balance)}</span></li>
              ))}
              {response.unpaid.length === 0 && <li className="text-muted-foreground text-center py-4">لا توجد</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (response.kind === "revenue_report") {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-xs text-muted-foreground">{response.range.label}: {response.range.from} → {response.range.to}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="نقدي" value={fmtYER(response.totals.cash)} icon={<Wallet className="w-4 h-4 text-water" />} />
            <StatBox label="الكريمي" value={fmtYER(response.totals.bank)} icon={<Smartphone className="w-4 h-4 text-primary" />} />
            <StatBox label="الإجمالي" value={fmtYER(response.totals.total)} tone="ok" icon={<CircleDollarSign className="w-4 h-4 text-emerald-600" />} />
            <StatBox label="متوسط الدفعة" value={fmtYER(response.totals.avg)} icon={<TrendingUp className="w-4 h-4 text-muted-foreground" />} />
          </div>
          {response.series.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={response.series}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtYER(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="cash" name="نقدي" stroke="var(--water)" />
                  <Line type="monotone" dataKey="bank" name="الكريمي" stroke="var(--electric-2)" />
                  <Line type="monotone" dataKey="total" name="الإجمالي" stroke="#059669" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">لا توجد دفعات معتمدة في هذه الفترة</p>
          )}
          <Badge variant="outline" className="text-[11px]">
            {response.totals.count} عملية معتمدة
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function StatBox({ label, value, tone, icon }: { label: string; value: string; tone?: "ok" | "danger"; icon?: React.ReactNode }) {
  const cls = tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : tone === "danger" ? "border-destructive/30 bg-destructive/5" : "bg-muted/30";
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm font-bold mt-1 ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function LossCard({ label, pct, loss, icon }: { label: string; pct: number; loss: number; icon: React.ReactNode }) {
  const danger = pct > 15;
  return (
    <div className={`p-3 rounded-lg border ${danger ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-xl font-bold mt-1 ${danger ? "text-destructive" : ""}`}>{pct.toFixed(1)}%</div>
      <div className="text-[11px] text-muted-foreground">{fmtNum(loss)} وحدة فاقد</div>
    </div>
  );
}
