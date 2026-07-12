# Dataeum

CSV, XLSX, JSON 파일을 업로드하면 데이터 구조와 품질을 확인하고 추천 그래프와 핵심 인사이트를 만드는 로컬 웹 대시보드입니다.

## 주요 기능

- CSV 구분자 자동 감지와 따옴표, BOM, 중복 헤더 처리
- 일반적인 표 구조의 `.xlsx` 분석과 비정상 문서 차단
- 객체 배열 및 최상위 객체 내부 배열 형태의 JSON 분석
- 숫자, 날짜, 범주, 식별자 타입 자동 추정
- 결측치, 중복 행, IQR 이상값 품질 진단
- 빈도, 시계열, 합계, 평균, 분포, 산점도 자동 추천
- 상위 범주 점유율과 수치형 지표 상관관계 자동 설명
- 데이터 미리보기와 인쇄/PDF 리포트 저장

## 지원 파일

| 형식 | 지원 범위 |
| --- | --- |
| CSV | UTF-8, 쉼표·탭·세미콜론·파이프 구분자 |
| XLSX | 첫 번째로 표시된 워크시트의 일반적인 단일 표 |
| JSON | 객체 배열, 행 배열, 최상위 객체 내부의 배열 |

파일은 최대 100MB, 표는 최대 500열과 500,000행까지 허용합니다. 병합 셀이 있거나 헤더가 불명확한 XLSX, 불규칙한 문서형 시트, `.xls`, `.xlsm`은 분석하지 않습니다.

## 로컬 실행

필요한 프로그램:

- Linux 또는 WSL
- Node.js 18 이상과 npm
- C++20을 지원하는 g++
- make

```bash
git clone https://github.com/deploy103/dataeum.git
cd dataeum
./start.sh
```

브라우저에서 `http://localhost:8080`을 엽니다. 종료는 실행 터미널에서 `Ctrl+C`를 누릅니다.

## 서버 배포

Ubuntu 기준으로 먼저 도구를 설치합니다.

```bash
sudo apt update
sudo apt install -y git make g++ nodejs npm
git clone https://github.com/deploy103/dataeum.git /opt/dataeum
cd /opt/dataeum
make all
```

서버는 기본적으로 보안을 위해 `127.0.0.1:8080`에서만 수신합니다. 외부 공개 시 nginx 또는 Caddy를 앞에 두고 HTTPS, 인증, 업로드 속도 제한을 설정하세요.

systemd 서비스 예시(`/etc/systemd/system/dataeum.service`):

```ini
[Unit]
Description=Dataeum analysis server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/dataeum
ExecStart=/opt/dataeum/build/dataeum-server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

서비스를 활성화합니다.

```bash
sudo chown -R www-data:www-data /opt/dataeum
sudo systemctl daemon-reload
sudo systemctl enable --now dataeum
sudo systemctl status dataeum
```

## 서버 업데이트

GitHub에 새 버전이 올라오면 서버에서 다음 순서로 업데이트합니다.

```bash
cd /opt/dataeum
sudo -u www-data git pull --ff-only
sudo -u www-data make all
sudo systemctl restart dataeum
sudo systemctl status dataeum
```

`git pull --ff-only`을 사용하면 서버에서 직접 수정된 파일 때문에 원격 이력이 예상치 않게 합쳐지는 일을 막을 수 있습니다. 업데이트 전 운영 데이터나 별도 설정 파일은 저장소 밖에 보관하세요.

## 프로젝트 구조

```text
backend/main.cpp   C++20 HTTP 서버와 CSV 분석 API
src/app.ts         업로드 처리, 분석 UI, SVG 차트 렌더러
index.html         화면 구조
styles.css         반응형 UI 스타일
Makefile           프런트엔드와 서버 빌드
start.sh           빌드 후 서버 시작
```

업로드 원문은 파일로 저장하지 않으며 C++ 프로세스 메모리에서 분석합니다. 공개 운영 환경에서는 리버스 프록시, TLS, 요청 제한, 접근 로그와 운영 모니터링을 별도로 구성해야 합니다.

