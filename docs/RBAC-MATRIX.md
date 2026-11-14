# Matriks RBAC teramati — haloK@MPUS

Dibuat otomatis oleh `apps/api/test/security.test.ts` (53 rute × 5 peran = 265 permintaan). "diizinkan (4xx)" berarti lolos pemeriksaan izin lalu ditolak validasi/data (mis. ID uji tidak ada). Setiap "403 ditolak" juga tercatat sebagai `authz_denied` di jejak audit.

| Rute | Izin | cp | staff | leader | finance | admin |
|---|---|---|---|---|---|---|
| `GET /api/queue/t2` | tickets.t2.read | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/queue/t3` | tickets.t3.read | 403 ditolak | diizinkan (200) | 403 ditolak | diizinkan (200) | 403 ditolak |
| `GET /api/queue/all` | tickets.t3.work | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/phone-calls` | phone.log | diizinkan (400) | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/tickets/:id` | self.read | diizinkan (404) | diizinkan (404) | diizinkan (404) | diizinkan (404) | diizinkan (404) |
| `POST /api/tickets/:id/unmask` | customer.pii.unmask | 403 ditolak | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/claim` | tickets.t2.work | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/reply` | tickets.t2.work | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/resolve` | tickets.t2.work | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/escalate` | tickets.escalate | diizinkan (400) | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/tickets/:id/draft` | tickets.t2.work | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/templates` | tickets.t2.read | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/presence` | presence.set | diizinkan (400) | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/supervision/feed` | ai.supervise | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/ai-actions/:id/override` | ai.override | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/channels` | ai.supervise | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/ai/pause` | ai.pause | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/audit` | audit.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/kb` | kb.read | diizinkan (200) | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `POST /api/kb` | kb.manage | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/kb/:id/test` | kb.manage | 403 ditolak | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/kb/:id/publish` | kb.manage | 403 ditolak | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/params` | params.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `POST /api/params/proposals` | params.propose | 403 ditolak | diizinkan (400) | diizinkan (400) | 403 ditolak | 403 ditolak |
| `POST /api/params/proposals/:id/approve` | params.approve | 403 ditolak | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak |
| `GET /api/admin/users` | users.manage | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak | diizinkan (200) |
| `POST /api/admin/users` | users.manage | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak | diizinkan (400) |
| `GET /api/admin/channels` | channels.manage | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak | diizinkan (200) |
| `POST /api/admin/channels/:code` | channels.manage | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak | diizinkan (404) |
| `POST /api/admin/users/:id/active` | users.manage | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak | diizinkan (404) |
| `GET /api/kpi` | kpi.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/reports` | reports.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `POST /api/reports` | reports.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/reports/:id/download` | reports.read | 403 ditolak | diizinkan (404) | diizinkan (404) | 403 ditolak | 403 ditolak |
| `GET /api/exports/research` | research.export | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/audit/export` | audit.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/qa/sample` | qa.review | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/qa/reviews` | qa.review | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/supervision/cp` | cp.supervise | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/release` | cp.supervise | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/tickets/:id/return-to-cp` | cp.supervise | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/cp-feedback` | cp.supervise | 403 ditolak | diizinkan (400) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/me/feedback` | feedback.read_own | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/orchestration/current` | orchestration.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `GET /api/orchestration` | orchestration.read | 403 ditolak | diizinkan (200) | diizinkan (200) | 403 ditolak | 403 ditolak |
| `POST /api/orchestration/:id/items/:itemId` | orchestration.manage | 403 ditolak | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/orchestration/:id/close` | orchestration.manage | 403 ditolak | diizinkan (409) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/dsr` | dsr.manage | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/dsr/:id` | dsr.manage | 403 ditolak | diizinkan (404) | 403 ditolak | 403 ditolak | 403 ditolak |
| `POST /api/retention/run` | dsr.manage | 403 ditolak | diizinkan (200) | 403 ditolak | 403 ditolak | 403 ditolak |
| `GET /api/usability` | usability.respond | diizinkan (200) | diizinkan (200) | diizinkan (200) | diizinkan (200) | diizinkan (200) |
| `POST /api/usability/:code` | usability.respond | diizinkan (400) | diizinkan (400) | diizinkan (400) | diizinkan (400) | diizinkan (400) |
| `POST /api/kb/upload` | kb.manage | 403 ditolak | diizinkan (406) | 403 ditolak | 403 ditolak | 403 ditolak |
