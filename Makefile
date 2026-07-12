.PHONY: all frontend backend run clean

all: frontend backend

frontend:
	npm install --no-audit --no-fund
	npm run build
	cp node_modules/xlsx/dist/xlsx.full.min.js dist/assets/xlsx.full.min.js

backend:
	mkdir -p build
	g++ -std=c++20 -O2 -pthread -Wall -Wextra backend/main.cpp -o build/dataeum-server

run: all
	./build/dataeum-server

clean:
	rm -rf build dist
