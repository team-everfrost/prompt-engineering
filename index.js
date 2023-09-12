import chalk from 'chalk';
import { Table } from 'console-table-printer';
import 'dotenv/config';
import * as fs from 'node:fs/promises';
import hash from 'object-hash';
import OpenAI from 'openai';
import { hasOwn } from 'openai/core.js';

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
    const preprocessor = module.preprocessor;
    promptSet.push({ title: file, preprocessor, ...prompt });
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

  //* GPT 실행
  // data와 prompt 결합하여 입력 파라미터 생성
  const jobs = [];
  for (let prompt of promptSet) {
    const { title, preprocessor, ...inputPrompt } = prompt;
    const dataSet = preprocessor(rawDataSet);
    for (let data of dataSet) {
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

  await Promise.all(cachePromises);

  console.log('cached jobs:', results.filter((result) => result !== undefined).length);

  //* 사용하지 않는 캐시 삭제
  const purgeCachePromises = cacheList.map(async (file) => {
    const cacheKey = file.split('.').slice(0, -1).join('.');
    const index = cacheKeys.indexOf(cacheKey);

    if (index === -1) {
      await fs.rm(`./cache/${file}`);
    }
  });

  await Promise.all(purgeCachePromises);

  console.log('purged unuse caches:', cacheList.length - results.filter((result) => result !== undefined).length);

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
      });

      results[index] = JSON.parse(result.choices[0].message.function_call.arguments);
    });

    console.log('start requesting jobs...');
    await Promise.all(gptPromises);
    console.log('requested jobs done.');
  };

  // GPT 실행 결과 캐시에 저장
  const cachePromises2 = results.map(async (result, index) => {
    const cacheKey = cacheKeys[index];
    await fs.writeFile(`./cache/${cacheKey}.json`, JSON.stringify(result));
  });

  await Promise.all(cachePromises2);

  //* 실행 결과 검사 (함수 호출 형식, 언어 한국어인지)
  const checker = (result) => {
    if (typeof result !== 'object') {
      return { reuslt: 'ERR!!', message: '반환값이 object가 아닙니다.' };
    }

    //result는 { oneLineSummary, summary, hashtags } 형식
    if (!hasOwn(result, 'oneLineSummary') || !hasOwn(result, 'summary') || !hasOwn(result, 'hashtags')) {
      return { result: 'ERR!!', message: '반환값이 { oneLineSummary, summary, hashtags } 형식이 아닙니다.' };
    }

    const { oneLineSummary, summary, hashtags } = result;
    if (typeof summary !== 'string' || typeof oneLineSummary !== 'string') {
      return { result: 'ERR!!', message: '한 줄 요약 또는 요약이 string 형식이 아닙니다.' };
    }
    if (!Array.isArray(hashtags)) {
      return { result: 'ERR!!', message: '해시태그 목록이 Array 형식이 아닙니다.' };
    }
    if (hashtags.some((hashtag) => typeof hashtag !== 'string')) {
      return { result: 'ERR!!', message: '개별 해시태그가 string 형식이 아닙니다.' };
    }

    // 한 줄 요약 길이 검사
    if (oneLineSummary.length > 100) {
      return { result: 'WARN?', message: '한 줄 요약이 100자를 초과합니다.' };
    }

    // 요약 길이 검사
    if (summary.length > 1000) {
      return { result: 'WARN?', message: '요약이 1000자를 초과합니다.' };
    }

    // 해시태그 개수 검사
    if (hashtags.length > 10) {
      return { result: 'WARN?', message: '해시태그가 10개를 초과합니다.' };
    }

    //한글 포함 여부 검사
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    if (!koreanRegex.test(oneLineSummary) || !koreanRegex.test(summary)) {
      return { result: 'WARN?', message: '요약 또는 한 줄 요약에 한글이 포함되어 있지 않습니다.' };
    }

  return { result: 'PASS~', message: '검사를 통과했습니다.' };
  };

  //* 결과 보고서 생성
  const width = process.stdout.columns;
  const reportWidth = width - 3 - 5 - 4 - 20 - 10 - 25 - 5;
  const oneLineSummaryWidth = Math.floor(reportWidth * 0.3);
  const summaryWidth = Math.floor(reportWidth * 0.5);
  const hashtagsWidth = Math.floor(reportWidth * 0.1);
  const p = new Table({
    title: 'Report',
    rowSeparator: true,
    columns: [
      { name: 'index', alignment: 'center', maxLen: 3, color: 'gray' },
      { name: 'check', alignment: 'center', maxLen: 5 },
      { name: 'type', alignment: 'center', maxLen: 4, color: 'blue' },
      { name: 'title', alignment: 'left', maxLen: 20, color: 'magenta' },
      { name: 'prompt', alignment: 'left', maxLen: 10, color: 'cyan' },
      { name: 'oneLineSummary', alignment: 'left', maxLen: oneLineSummaryWidth, color: 'white' },
      { name: 'summary', alignment: 'left', maxLen: summaryWidth, color: 'white' },
      { name: 'hashtags', alignment: 'left', maxLen: hashtagsWidth, color: 'green' },
    ],
  });

  // 프롬프트별 결과 카운터
  const counter = {};

  results.forEach((result, index) => {
    const { title, type, _ } = rawDataSet[index % rawDataSet.length];
    const promptTitle = promptSet[Math.floor(index / rawDataSet.length)].title;
    const { oneLineSummary, summary, hashtags } = result;

    counter[promptTitle] = counter[promptTitle] || { pass: 0, warn: 0, error: 0, warnList: [], errorList: [] };

    let check;
    const checkResult = checker(result);
    if (checkResult.result === 'PASS~') {
      check = chalk.green.bold('PASS~');
      counter[promptTitle].pass++;
    } else if (checkResult.result === 'ERR!!') {
      check = chalk.red.bold('ERR!!');
      counter[promptTitle].error++;
      counter[promptTitle].errorList.push({ index, type, title, message: checkResult.message });
    } else if (checkResult.result === 'WARN?') {
      check = chalk.yellow.bold('WARN?');
      counter[promptTitle].warn++;
      counter[promptTitle].warnList.push({ index, type, title, message: checkResult.message });
    }

    p.addRow({
      index,
      check,
      type,
      title,
      prompt: promptTitle,
      oneLineSummary,
      summary,
      hashtags: hashtags.join(', '),
    });
  });

  p.printTable();

  for (let promptTitle in counter) {
    const { pass, warn, error } = counter[promptTitle];
    console.log(chalk.blue.bold(`\n${promptTitle}`));
    console.log(chalk.green.bold(`PASS: ${pass}`) + chalk.yellow.bold(` WARN: ${warn}`) + chalk.red.bold(` ERROR: ${error}`));
    if (warn > 0) {
      console.log(chalk.yellow.bold('WARN LIST:'));
      counter[promptTitle].warnList.forEach((warn) => {
        console.log(chalk.yellow(`[${warn.index}] (${warn.type}) ${warn.title}: ${warn.message}`));
      });
    }
    if (error > 0) {
      console.log(chalk.red.bold('ERROR LIST:'));
      counter[promptTitle].errorList.forEach((error) => {
        console.log(chalk.red(`[${error.index}] (${error.type}) ${error.title}: ${error.message}`));
      });
    }
  }

};

main();
