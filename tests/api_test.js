import http from 'k6/http';
import { sleep } from 'k6';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// 定义自定义指标
let customReqDuration = new Trend('custom_http_req_duration');  // 修改了指标名称
let reqFailed = new Counter('custom_http_req_failed');
let reqs = new Counter('custom_http_reqs');

const API_LIST_PATH = '../postman.json';
const postmanCollection = JSON.parse(open(API_LIST_PATH));
const variables = postmanCollection.variable;

// 函数：替换 URL 中的变量
function replaceVariables(url, variables) {
    let replacedUrl = url;
    variables.forEach(variable => {
        const { key, value } = variable;
        const regex = new RegExp(`{{${key}}}`, 'g'); // 匹配所有 {{key}} 的占位符
        replacedUrl = replacedUrl.replace(regex, value);
    });
    return replacedUrl;
}

// 函数：提取请求信息（请求方法、URL 和参数）
function extractApiData(collection) {
    const apiList = [];

    // 遍历 Postman Collection 中的所有请求项
    collection.item.forEach(item => {
        const name = item.name;
        const request = item.request;
        const method = request.method;
        let baseUrl = request.url.raw;

        // 替换 URL 中的 {{url}} 为实际的变量值
        baseUrl = replaceVariables(baseUrl, variables);

        // 获取查询参数
        const queryParams = request.url.query || [];

        // 构造参数列表（key-value 格式）
        const params = {};
        queryParams.forEach(param => {
            params[param.key] = param.value;
        });

        // 将请求信息保存到 apiList 数组
        apiList.push({
            name: name,
            method,
            url: baseUrl,
            params: params
        });
    });

    return apiList;
}

// 从 Postman Collection 中提取 API 数据
const apiList = extractApiData(postmanCollection);

const customMetrics = {};
apiList.forEach(api =>{
    customMetrics[api.name] = {
        duration: new Trend(`http_req_duration_${api.name}`),
        failed: new Counter(`http_req_failed_${api.name}`),
        requests: new Counter(`http_reqs_${api.name}`)
    }
});

console.log(customMetrics);

export default function () {
    apiList.forEach(api => {
        console.log(JSON.stringify(api, null, 4));
        let res;

        // 测试请求
        if (api.method === "GET") {
            res = http.get(api.url);
        } else if (api.method === "POST") {
            res = http.post(api.url, JSON.stringify(api.params), { headers: { 'Content-Type': 'application/json' } });
        }


        // 使用每個 API 的自定義指標來記錄數據
        customMetrics[api.name].duration.add(res.timings.duration); 
        customMetrics[api.name].failed.add(res.status !== 200 ? 1 : 0); 
        customMetrics[api.name].requests.add(1);

        // 检查响应
        check(res, { 'status is 200': (r) => r.status === 200 });

        console.log(`Tested ${api.method} ${api.url} - Status: ${res.status}`);
        console.log(res.body);

        sleep(1);
    });
}

// 在測試結束後輸出個別的指標數據
export function handleSummary(data) {
    const summary = {};

    // 遍歷 customMetrics 中的服務名稱
    Object.keys(customMetrics).forEach(name => {
        // 根據服務名稱獲取指標數據並分類
        summary[name] = {
            http_req_duration: data.metrics[`http_req_duration_${name}`] || {},
            http_req_failed: data.metrics[`http_req_failed_${name}`] || {},
            http_reqs: data.metrics[`http_reqs_${name}`] || {}
        };
    });

    console.log(summary);

    // 返回輸出的結果
    return {
        // 輸出格式化的 JSON 到 stdout
        'stdout': JSON.stringify(summary, null, 2), 
        // 輸出完整的 metrics 數據到 json-summary.json 文件
        'json-summary.json': JSON.stringify(summary, null, 2)  
    };
}