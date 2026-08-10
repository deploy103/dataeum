#include <algorithm>
#include <arpa/inet.h>
#include <charconv>
#include <cmath>
#include <csignal>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <netinet/in.h>
#include <set>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace fs = std::filesystem;
constexpr size_t MAX_UPLOAD = 100 * 1024 * 1024;
constexpr size_t MAX_ROWS = 500000;

std::string json(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    switch(c) { case '"': o += "\\\""; break; case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break; case '\r': o += "\\r"; break; case '\t': o += "\\t"; break;
      default: if(c < 32) { char b[7]; snprintf(b,sizeof b,"\\u%04x",c); o += b; } else o += char(c); }
  }
  return o + "\"";
}

std::vector<std::vector<std::string>> parse_csv(const std::string& input, char& delimiter) {
  auto first_end=input.find('\n'); std::string first=input.substr(0,first_end);
  std::vector<char> candidates={',',';','\t','|'}; size_t best=0;
  for(char d:candidates){ bool q=false;size_t n=0;for(char c:first){if(c=='"')q=!q;else if(c==d&&!q)n++;}if(n>best){best=n;delimiter=d;} }
  std::vector<std::vector<std::string>> out; std::vector<std::string> row; std::string field; bool quoted=false;
  size_t start=(input.size()>=3&&(unsigned char)input[0]==0xEF&&(unsigned char)input[1]==0xBB&&(unsigned char)input[2]==0xBF)?3:0;
  for(size_t i=start;i<input.size();++i){char c=input[i];if(c=='"'){if(quoted&&i+1<input.size()&&input[i+1]=='"'){field+='"';++i;}else quoted=!quoted;}
    else if(c==delimiter&&!quoted){row.push_back(field);field.clear();}
    else if((c=='\n'||c=='\r')&&!quoted){if(c=='\r'&&i+1<input.size()&&input[i+1]=='\n')++i;row.push_back(field);field.clear();if(row.size()>1||!row[0].empty())out.push_back(std::move(row));row.clear();if(out.size()>MAX_ROWS)throw std::runtime_error("행 수가 서버 제한을 초과했습니다.");}
    else field+=c;
  }
  if(quoted) throw std::runtime_error("닫히지 않은 따옴표가 있습니다.");
  row.push_back(field); if(row.size()>1||!row[0].empty())out.push_back(std::move(row)); return out;
}

bool number(const std::string& s,double& out){std::string v;for(char c:s)if(c!=','&&c!=' '&&c!='%'&&c!='$')v+=c;if(v.empty())return false;char* end=nullptr;out=strtod(v.c_str(),&end);return end==v.c_str()+v.size()&&std::isfinite(out);}
bool date_like(const std::string& s){return s.size()>=7&&isdigit((unsigned char)s[0])&&isdigit((unsigned char)s[1])&&isdigit((unsigned char)s[2])&&isdigit((unsigned char)s[3])&&(s[4]=='-'||s[4]=='/'||s[4]=='.');}
bool missing(const std::string& s){std::string v=s;std::transform(v.begin(),v.end(),v.begin(),::tolower);return v.empty()||v=="null"||v=="n/a"||v=="na";}

std::string analyze(const std::string& body, const std::string& filename) {
  if(body.empty()) throw std::runtime_error("빈 파일입니다.");
  char delim=',';
  auto data=parse_csv(body,delim);
  if(data.size()<2) throw std::runtime_error("헤더 외에 데이터가 없습니다.");
  size_t cols=0;for(auto&r:data)cols=std::max(cols,r.size());auto headers=data[0];while(headers.size()<cols)headers.push_back("column_"+std::to_string(headers.size()+1));
  std::map<std::string,int> names;for(size_t i=0;i<headers.size();++i){if(headers[i].empty())headers[i]="column_"+std::to_string(i+1);int n=++names[headers[i]];if(n>1)headers[i]+="_"+std::to_string(n);}
  std::vector<std::vector<std::string>> rows(data.begin()+1,data.end());for(auto&r:rows)r.resize(cols);
  std::ostringstream o;o<<"{\"fileName\":"<<json(filename)<<",\"delimiter\":"<<json(std::string(1,delim))<<",\"rowCount\":"<<rows.size()<<",\"headers\":[";
  for(size_t i=0;i<headers.size();++i){if(i)o<<',';o<<json(headers[i]);}o<<"],\"profiles\":[";
  for(size_t c=0;c<cols;++c){if(c)o<<',';size_t miss=0,num=0,dates=0;std::set<std::string> uniq;std::vector<double> nums;std::vector<std::string> examples;
    for(auto&r:rows){auto&v=r[c];if(missing(v)){++miss;continue;}uniq.insert(v);double n;if(number(v,n)){++num;nums.push_back(n);}if(date_like(v))++dates;if(examples.size()<2)examples.push_back(v);}
    size_t valid=rows.size()-miss;std::string type="범주";if(valid&&dates*100/valid>=85)type="날짜";else if(valid&&num*100/valid>=90)type=(uniq.size()<=std::min<size_t>(12,std::max<size_t>(1,valid/4))?"순서/코드":"숫자");else if(uniq.size()==2)type="불리언";else if(valid&&uniq.size()*100/valid>90)type="식별자";
    size_t outs=0;double avg=0,min=0,max=0;if(!nums.empty()){std::sort(nums.begin(),nums.end());min=nums.front();max=nums.back();for(double n:nums)avg+=n;avg/=nums.size();double q1=nums[(nums.size()-1)/4],q3=nums[((nums.size()-1)*3)/4],iqr=q3-q1;for(double n:nums)if(n<q1-1.5*iqr||n>q3+1.5*iqr)++outs;}
    o<<"{\"name\":"<<json(headers[c])<<",\"index\":"<<c<<",\"type\":"<<json(type)<<",\"unique\":"<<uniq.size()<<",\"missing\":"<<miss<<",\"outliers\":"<<outs<<",\"avg\":"<<avg<<",\"min\":"<<min<<",\"max\":"<<max<<",\"examples\":[";for(size_t i=0;i<examples.size();++i){if(i)o<<',';o<<json(examples[i]);}o<<"]}";
  }
  o<<"],\"rows\":[";size_t send=std::min<size_t>(rows.size(),10000);for(size_t r=0;r<send;++r){if(r)o<<',';o<<'[';for(size_t c=0;c<cols;++c){if(c)o<<',';o<<json(rows[r][c]);}o<<']';}o<<"],\"sampled\":"<<(send<rows.size()?"true":"false")<<"}";return o.str();
}

std::string lower(std::string s){std::transform(s.begin(),s.end(),s.begin(),::tolower);return s;}
void response(int fd,int code,const std::string&type,const std::string&body){std::ostringstream h;h<<"HTTP/1.1 "<<code<<(code==200?" OK":" Error")<<"\r\nContent-Type: "<<type<<"\r\nContent-Length: "<<body.size()<<"\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";auto x=h.str();send(fd,x.data(),x.size(),0);send(fd,body.data(),body.size(),0);}
void client(int fd,const fs::path&root){
  try{std::string req;char buf[8192];while(req.find("\r\n\r\n")==std::string::npos&&req.size()<65536){ssize_t n=recv(fd,buf,sizeof buf,0);if(n<=0)throw std::runtime_error("bad request");req.append(buf,n);}auto end=req.find("\r\n\r\n");std::string head=req.substr(0,end),body=req.substr(end+4);std::istringstream hs(head);std::string method,path,ver;hs>>method>>path>>ver;std::map<std::string,std::string> headers;std::string line;getline(hs,line);while(getline(hs,line)){if(!line.empty()&&line.back()=='\r')line.pop_back();auto p=line.find(':');if(p!=std::string::npos){auto k=lower(line.substr(0,p)),v=line.substr(p+1);while(!v.empty()&&v[0]==' ')v.erase(v.begin());headers[k]=v;}}
    if(method=="POST"&&path=="/api/analyze"){size_t len=std::stoull(headers["content-length"]);if(len>MAX_UPLOAD){response(fd,413,"application/json; charset=utf-8","{\"error\":\"파일이 100MB 제한을 초과했습니다.\"}");close(fd);return;}while(body.size()<len){ssize_t n=recv(fd,buf,std::min(sizeof buf,len-body.size()),0);if(n<=0)break;body.append(buf,n);}if(body.size()!=len)throw std::runtime_error("업로드가 중단되었습니다.");auto ct=headers["content-type"];if(ct.find("text/csv")==std::string::npos&&ct.find("application/octet-stream")==std::string::npos)throw std::runtime_error("CSV 콘텐츠 형식이 아닙니다.");std::string name=headers.count("x-filename")?headers["x-filename"]:"upload.csv";response(fd,200,"application/json; charset=utf-8",analyze(body,name));}
    else if(method=="GET"){if(path=="/")path="/index.html";if(path.find("..")!=std::string::npos||path.find('\\')!=std::string::npos)throw std::runtime_error("잘못된 경로입니다.");fs::path file=path.rfind("/assets/",0)==0?root/"dist"/path.substr(1):root/path.substr(1);if(!fs::is_regular_file(file)){response(fd,404,"text/plain; charset=utf-8","Not found");}else{std::ifstream f(file,std::ios::binary);std::string b((std::istreambuf_iterator<char>(f)),{});std::string ext=file.extension().string(),type=ext==".html"?"text/html; charset=utf-8":ext==".css"?"text/css; charset=utf-8":"text/javascript; charset=utf-8";response(fd,200,type,b);}}
    else response(fd,405,"text/plain; charset=utf-8","Method not allowed");
  }catch(const std::exception&e){response(fd,400,"application/json; charset=utf-8",std::string("{\"error\":")+json(e.what())+"}");}close(fd);
}
int main(){signal(SIGPIPE,SIG_IGN);int server=socket(AF_INET,SOCK_STREAM,0),yes=1;setsockopt(server,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof yes);sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_ANY);addr.sin_port=htons(8001);if(bind(server,(sockaddr*)&addr,sizeof addr)<0){std::cerr<<"포트 8001을 사용할 수 없습니다.\n";return 1;}listen(server,32);auto root=fs::current_path();std::cout<<"Dataeum: http://0.0.0.0:8001\n"<<std::flush;while(true){int fd=accept(server,nullptr,nullptr);if(fd>=0)std::thread(client,fd,root).detach();}}
