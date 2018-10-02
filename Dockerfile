FROM mhart/alpine-node:8.9.0

RUN apk add --no-cache make gcc g++ python git
RUN apk add --no-cache vips-dev fftw-dev --repository https://dl-3.alpinelinux.org/alpine/edge/testing/
RUN npm install -g
RUN npm install -g -s --no-progress wait-port yarn ts-node typescript

RUN mkdir -p /app/data/database
WORKDIR /app/
COPY package.json /app
COPY yarn.lock /app

#RUN yarn install
#COPY . /app/
#RUN bin/ci-create-dbs.sh
#RUN bin/ci-create-build-version.sh
#VOLUME /app/data
#VOLUME /app/
#CMD [ "yarn", "serve" ]
#CMD [ "bin/entrypoint.sh" ]

EXPOSE 3000 3100 3200
