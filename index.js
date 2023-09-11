import chalk from 'chalk';
import 'dotenv/config';
import * as fs from 'node:fs/promises';
import hash from 'object-hash';
import OpenAI from 'openai';
import { preprocess } from './preprocess.js';

const main = async () => {

  const openai = new OpenAI();
  const model = 'gpt-3.5-turbo';

  console.log('start loading data...');

  //* 파일 로드
  //data 폴더에서 텍스트 파일 로드 파일 이름에서 마지막 .txt만 삭제
  //file, memo, webpage 하위 폴더로 자료 종류 구분, 파일명은 제목 취급
  //한 파일 객체에는 type, title, content

  //데이터 로드 함수
  async function loadDataSet(path) {
    const files = await fs.readdir(path);
    const fileData = [];

    for (let file of files) {
      const data = await fs.readFile(`${path}/${file}`, 'utf8');
      const title = file.split('.').slice(0, -1).join('.');
      fileData.push({ title, content: data });
    }

    return fileData;
  }

  //* 프롬프트 셋 로드
  //js 파일 로드
  const promptSet = [];
  const promptFiles = await fs.readdir('./prompt');
  const promptPromises = promptFiles.map(async (file) => {
    const module = await import(`./prompt/${file}`);
    const prompt = module.prompt;
    promptSet.push({ title: file, ...prompt });
  });

  // 파일 로드처리
  const [files, memos, webpages] = await Promise.all([
    loadDataSet('./data/file'),
    loadDataSet('./data/memo'),
    loadDataSet('./data/webpage'),
  ]);
  const rawDataSet = [
    ...files.map((file) => ({ ...file, type: 'file' })),
    ...memos.map((memo) => ({ ...memo, type: 'memo' })),
    ...webpages.map((webpage) => ({ ...webpage, type: 'webpage' })),
  ];
  console.log('loaded data count:', rawDataSet.length);

  await Promise.all(promptPromises);
  console.log('loaded prompt count:', promptSet.length);

  //* 데이터 셋 전처리
  const dataSet = preprocess(rawDataSet);
  console.log('data preprocessed.');

  //* GPT 실행
  // data와 prompt 결합하여 입력 파라미터 생성
  const jobs = [];
  for (let prompt of promptSet) {
    for (let data of dataSet) {
      const { title, ...inputPrompt } = prompt;
      const param = {
        ...inputPrompt,
        input: data,
      };
      jobs.push(param);
    }
  }

  console.log('total jobs:', jobs.length);

  // 결과를 job 개수만큼 담을 배열 생성
  const results = new Array(jobs.length);

  // 입력 파라미터 해싱하여 캐시 키 생성
  const cacheKeys = jobs.map((job) => hash(job));

  // 캐시 키로 캐시 조회 후 결과가 있으면 결과 배열에 저장
  const cacheList = await fs.readdir('./cache');
  const cachePromises = cacheList.map(async (file) => {

    const cacheKey = file.split('.').slice(0, -1).join('.');
    const index = cacheKeys.indexOf(cacheKey);

    if (index !== -1) {
      const data = await fs.readFile(`./cache/${file}`, 'utf8');
      results[index] = JSON.parse(data);
    }
  });

  console.log('cached jobs:', cacheList.length);

  await Promise.all(cachePromises);

  // 캐시에 없는 작업만 필터링
  const filteredJobs = [];
  jobs.forEach((job, index) => {
    if (results[index] === undefined) {
      filteredJobs.push({ job, index });
    }
  });

  // 필터링된 작업이 있으면 GPT 실행
  console.log('requested jobs:', filteredJobs.length);
  if (filteredJobs.length > 0) {

    // GPT 실행
    const gptPromises = filteredJobs.map(async ({ job, index }) => {
      const { prompt, input, ...params } = job;
      const result = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: input },
        ],
        ...params,
        functions: [
          {
            name: 'insertMetadata',
            description: 'Inserts summary and hashtags into the article metadata',
            parameters: {
              type: 'object',
              properties: {
                oneLineSummary: {
                  type: 'string',
                  description:
                    'a concise summary of the entire document within one sentence',
                },
                summary: {
                  type: 'string',
                  description:
                    'concise, one-paragraph or less summary of the entire document',
                },
                hashtags: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'A list of hashtags for the article',
                },
              },
              required: ['oneLineSummary', 'summary', 'hashtags'],
            },
          },
        ],
        function_call: {
          name: 'insertMetadata',
        },
      });

      results[index] = JSON.parse(result.choices[0].message.function_call.arguments);
    });

    await Promise.all(gptPromises);
  };

  // GPT 실행 결과 캐시에 저장
  const cachePromises2 = results.map(async (result, index) => {
    const cacheKey = cacheKeys[index];
    await fs.writeFile(`./cache/${cacheKey}.json`, JSON.stringify(result));
  });

  await Promise.all(cachePromises2);

  //* 실행 결과 검사 (함수 호출 형식, 언어 한국어인지)
  const checker = (result) => {
    const { oneLineSummary, summary, hashtags } = result;
    if (typeof summary !== 'string' || typeof oneLineSummary !== 'string') {
      return 'ERROR';
    }
    if (!Array.isArray(hashtags)) {
      return 'ERROR';
    }
    if (hashtags.some((hashtag) => typeof hashtag !== 'string')) {
      return 'ERROR';
    }

    if (oneLineSummary.length > 100) {
      return 'WARN?';
    }

    if (summary.length > 1000) {
      return 'WARN?';
    }

    if (hashtags.length > 10) {
      return 'WARN?';
    }

    //한글 포함 여부 검사
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    if (!koreanRegex.test(oneLineSummary) || !koreanRegex.test(summary)) {
      return 'WARN?';
    }

    return 'PASS~';
  };

  //* 결과 보고서 생성
  console.log('report:');
  const counter = {
    pass: 0,
    warn: 0,
    error: 0,
  };
  results.forEach((result, index) => {
    const { title, type } = rawDataSet[index];
    const promptTitle = promptSet.find((prompt) => {
      const { title, ...promptData } = prompt;
      const { input, ...jobPrompt } = jobs[index];
      return hash(promptData) === hash(jobPrompt);
    }).title;
    const { oneLineSummary, summary, hashtags } = result;
    let check;
    if (checker(result) === 'PASS~') {
      check = chalk.green.bold(checker(result));
      counter.pass++;
    } else if (checker(result) === 'ERR!!') {
      check = chalk.red.bold(checker(result));
      counter.error++;
    } else if (checker(result) === 'WARN?') {
      check = chalk.yellow.bold(checker(result));
      counter.warn++;
    }
    console.log(chalk.gray(`[${index}] `) + `[${check}] ` + chalk.magenta(`(${type}) ${title} `) + '+ ' + chalk.cyan(promptTitle) + ` | ${oneLineSummary} | ${summary} | `, hashtags);
  });

  console.log(chalk.blue.bold(`\nTOTAL: ${counter.pass + counter.warn + counter.error}`));
  console.log(chalk.green.bold(`PASS: ${counter.pass}`) + chalk.yellow.bold(` WARN: ${counter.warn}`) + chalk.red.bold(` ERROR: ${counter.error}`));
};

main();
