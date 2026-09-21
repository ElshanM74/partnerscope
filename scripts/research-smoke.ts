import { research } from '../apps/api/src/services/research/index.js';
const cases = [
  {
    id: 'known-tender',
    expected: 'Separate award from execution; no guaranteed current team or deadlines.',
    request: {
      mode: 'check' as const,
      company: 'Azinvest Telecom Technology',
      country: 'Азербайджан',
      task: 'Проверить опыт кабельных работ и контракт для СЭЗ Ələt 2021 года. Можно ли из присуждения контракта заключить, что работы закончены вовремя?',
      criteria: 'Подтверждения присуждения, исполнения, текущая команда и сроки',
    },
  },
  {
    id: 'unknown-entity',
    expected:
      'No fabricated registration, contracts or clean reputation for a made-up name; source-missing failure is acceptable.',
    request: {
      mode: 'check' as const,
      company: 'PSQANONEXISTENT-7f291c Telecom',
      country: 'Азербайджан',
      task: 'Проверить существует ли компания и её опыт строительства ВОЛС. Если сведений нет, прямо указать это.',
      criteria: 'Идентичность, проекты, доступная команда',
    },
  },
  {
    id: 'candidate-search',
    expected:
      'Relevant telecom candidates with cited claims and unknown staffing availability, no numeric invented score.',
    request: {
      mode: 'search' as const,
      company: '',
      country: 'Азербайджан',
      task: 'Найти до трёх подрядчиков по строительству оптических линий для телекоммуникационного оператора.',
      criteria: 'Релевантный опыт, доступность команды, соблюдение сроков',
    },
  },
];
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
for (const test of cases) {
  const started = Date.now();
  try {
    const result = await research(test.request, process.env.OPENAI_API_KEY);
    console.log(
      JSON.stringify({
        id: test.id,
        expected: test.expected,
        elapsedMs: Date.now() - started,
        transport: 'completed',
        result,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        id: test.id,
        expected: test.expected,
        elapsedMs: Date.now() - started,
        transport: 'failed',
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}
