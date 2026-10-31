/** Server-side wording for notifications. Each member gets them in their own language. */
export type Lang = 'en' | 'ko' | 'fr' | 'id';
export const LANGS: Lang[] = ['en', 'ko', 'fr', 'id'];

type Tpl = Record<Lang, { title: string; body?: string }>;
const templates: Record<string, Tpl> = {
  event_published_kingdom: {
    en: { title: 'New kingdom event: {title}', body: 'Starts {time} UTC.' },
    ko: { title: '새 왕국 이벤트: {title}', body: '시작: {time} UTC' },
    fr: { title: 'Nouvel événement du royaume : {title}', body: 'Début : {time} UTC.' },
    id: { title: 'Acara kerajaan baru: {title}', body: 'Mulai {time} UTC.' },
  },
  event_published_alliance: {
    en: { title: 'New alliance event: {title}', body: 'Starts {time} UTC.' },
    ko: { title: '새 연맹 이벤트: {title}', body: '시작: {time} UTC' },
    fr: { title: "Nouvel événement d'alliance : {title}", body: 'Début : {time} UTC.' },
    id: { title: 'Acara aliansi baru: {title}', body: 'Mulai {time} UTC.' },
  },
  event_changed: {
    en: { title: 'Rescheduled: {title}', body: 'New time: {time} UTC.' },
    ko: { title: '일정 변경: {title}', body: '새 시간: {time} UTC' },
    fr: { title: 'Reprogrammé : {title}', body: 'Nouvel horaire : {time} UTC.' },
    id: { title: 'Dijadwal ulang: {title}', body: 'Waktu baru: {time} UTC.' },
  },
  event_cancelled: {
    en: { title: 'Cancelled: {title}', body: '{reason}' },
    ko: { title: '취소됨: {title}', body: '{reason}' },
    fr: { title: 'Annulé : {title}', body: '{reason}' },
    id: { title: 'Dibatalkan: {title}', body: '{reason}' },
  },
  event_proposed: {
    en: { title: 'Event proposed: {title}', body: 'Proposed by {name}. Review it before it can be published.' },
    ko: { title: '이벤트 제안: {title}', body: '{name} 님이 제안했습니다. 게시하기 전에 검토하세요.' },
    fr: { title: 'Événement proposé : {title}', body: 'Proposé par {name}. Vérifiez-le avant sa publication.' },
    id: { title: 'Acara diusulkan: {title}', body: 'Diusulkan oleh {name}. Tinjau sebelum dipublikasikan.' },
  },
  assignment: {
    en: { title: 'Assignment for {title}', body: '{assignment}' },
    ko: { title: '{title} 배정', body: '{assignment}' },
    fr: { title: 'Affectation pour {title}', body: '{assignment}' },
    id: { title: 'Tugas untuk {title}', body: '{assignment}' },
  },
  appointment_reminder: {
    en: { title: 'Your appointment starts in {mins} min: {position}', body: '{schedule} · {time} UTC' },
    ko: { title: '{mins}분 후 임명 시작: {position}', body: '{schedule} · {time} UTC' },
    fr: { title: 'Votre nomination commence dans {mins} min : {position}', body: '{schedule} · {time} UTC' },
    id: { title: 'Jabatan Anda dimulai dalam {mins} menit: {position}', body: '{schedule} · {time} UTC' },
  },
  appointment_assigned: {
    en: { title: 'You were given {position}', body: '{schedule} · {time} UTC' },
    ko: { title: '{position}에 배정되었습니다', body: '{schedule} · {time} UTC' },
    fr: { title: 'Vous avez reçu {position}', body: '{schedule} · {time} UTC' },
    id: { title: 'Anda mendapat {position}', body: '{schedule} · {time} UTC' },
  },
  appointment_removed: {
    en: { title: 'Your {position} slot was removed', body: '{schedule} · {time} UTC' },
    ko: { title: '{position} 시간대가 취소되었습니다', body: '{schedule} · {time} UTC' },
    fr: { title: 'Votre créneau {position} a été retiré', body: '{schedule} · {time} UTC' },
    id: { title: 'Slot {position} Anda dihapus', body: '{schedule} · {time} UTC' },
  },
  plan_from_leader: {
    en: { title: '{name} made an upgrade plan for you: {plan}', body: '{note}' },
    ko: { title: '{name} 님이 업그레이드 계획을 만들었습니다: {plan}', body: '{note}' },
    fr: { title: "{name} a créé un plan d'amélioration pour vous : {plan}", body: '{note}' },
    id: { title: '{name} membuat rencana peningkatan untuk Anda: {plan}', body: '{note}' },
  },
  resources_updated_by_leader: {
    en: { title: '{name} updated your resources and speedups', body: 'Check them in Resources & buildings.' },
    ko: { title: '{name} 님이 내 자원과 가속을 수정했습니다', body: '자원 & 건물에서 확인하세요.' },
    fr: { title: '{name} a mis à jour vos ressources et accélérateurs', body: 'Vérifiez dans Ressources et bâtiments.' },
    id: { title: '{name} memperbarui sumber daya dan percepatan Anda', body: 'Periksa di Sumber daya & bangunan.' },
  },
  buildings_updated_by_leader: {
    en: { title: '{name} updated your building levels', body: 'Check them in Resources & buildings.' },
    ko: { title: '{name} 님이 내 건물 레벨을 수정했습니다', body: '자원 & 건물에서 확인하세요.' },
    fr: { title: '{name} a mis à jour vos niveaux de bâtiments', body: 'Vérifiez dans Ressources et bâtiments.' },
    id: { title: '{name} memperbarui level bangunan Anda', body: 'Periksa di Sumber daya & bangunan.' },
  },
  email_button: { en: { title: 'Open the Command Center' }, ko: { title: '커맨드 센터 열기' }, fr: { title: 'Ouvrir le Command Center' }, id: { title: 'Buka Command Center' } },
  email_footer: {
    en: { title: 'You get this because email notifications are on. Turn them off in Settings › Notifications.' },
    ko: { title: '이메일 알림이 켜져 있어 받은 메일입니다. 설정 › 알림에서 끌 수 있습니다.' },
    fr: { title: 'Vous recevez ceci car les notifications par e-mail sont activées. Désactivez-les dans Paramètres › Notifications.' },
    id: { title: 'Anda menerima ini karena notifikasi email aktif. Matikan di Pengaturan › Notifikasi.' },
  },
  what_resources: { en: { title: 'resources and speedups' }, ko: { title: '자원과 가속' }, fr: { title: 'ressources et accélérateurs' }, id: { title: 'sumber daya dan percepatan' } },
  what_buildings: { en: { title: 'building levels' }, ko: { title: '건물 레벨' }, fr: { title: 'niveaux de bâtiments' }, id: { title: 'level bangunan' } },
  sharing_turned_on: {
    en: { title: '{name} turned on sharing for you', body: 'Your alliance R4/R5 and the kingdom admin can now see your resources and building levels to help plan upgrades. You can turn this off in Settings › Privacy.' },
    ko: { title: '{name} 님이 공유를 켰습니다', body: '이제 연맹 R4/R5와 왕국 관리자가 업그레이드 계획을 돕기 위해 내 자원과 건물 레벨을 볼 수 있습니다. 설정 › 개인정보에서 끌 수 있습니다.' },
    fr: { title: '{name} a activé le partage pour vous', body: "Les R4/R5 de votre alliance et l'admin du royaume voient désormais vos ressources et niveaux pour vous aider à planifier. Vous pouvez désactiver cela dans Paramètres › Confidentialité." },
    id: { title: '{name} menyalakan berbagi untuk Anda', body: 'R4/R5 aliansi dan admin kerajaan kini bisa melihat sumber daya dan level bangunan Anda untuk membantu merencanakan. Anda bisa mematikannya di Pengaturan › Privasi.' },
  },
  reminder: {
    en: { title: 'Starting in {mins} min: {title}' },
    ko: { title: '{mins}분 후 시작: {title}' },
    fr: { title: 'Commence dans {mins} min : {title}' },
    id: { title: 'Mulai dalam {mins} menit: {title}' },
  },
};

export function render(lang: string, key: string, params: Record<string, string | number> = {}) {
  const tpl = templates[key];
  if (!tpl) return null;
  const t = tpl[(LANGS as string[]).includes(lang) ? (lang as Lang) : 'en'];
  const fill = (s?: string) => (s ?? '').replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')).trim();
  return { title: fill(t.title), body: fill(t.body) };
}
