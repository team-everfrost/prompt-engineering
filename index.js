import 'dotenv/config';
import { Configuration, OpenAIApi } from 'openai-api';

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(config);

const model = 'gpt-3.5-turbo';

//TODO: 데이터 셋 로드

//TODO: 프롬프트 셋 로드

//TODO: 데이터 셋 전처리

//TODO: 코드 실행 (동일 input은 해시 기준으로 캐시처리)

//TODO: 실행 결과 검사 (함수 호출 형식, 언어 한국어인지)

//TODO: 결과 보고서 생성
