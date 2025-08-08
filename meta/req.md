#1 Company Data API (SW Engineer)
Task
The purpose of this assignment is to create an API that returns data about a company. You will need to follow multiple steps in order to create and store the list of companies that the API will query.

Steps
1. Data extraction 🔨
1.1 The scraping part

You are required to extract a set of datapoints starting from a predefined list of websites. The goal here is to extract as much valid data about a company as possible, in a reasonable time.

Datapoints to be extracted:

phone numbers
social media links
address / location (optional)
List of websites here: sample-websites.csv

1.2 The data analysis part

Run a quick analysis on the data you were able to extract:

how many websites were you able to crawl? (coverage)
how many datapoints were you able to extract from the websites you crawled? (fill rates)
1.3 The scaling part

Find a scalable way to crawl the entire list in no more than 10 minutes.


2. Data retrieval 🎣
For this part we recommend you use a Search Engine technology, such as ElasticSearch, Solr or Algolia.

2.1 The storing part

Merge the data extracted in the previous step with this dataset: sample-websites-company-names.csv


The resulting data must be stored in a format that can be further queried by one or multiple datapoints to retrieve an entire row (i.e. the profile of a company).

2.2 The querying (final) part

Build a REST API that accepts as input the name, website, phone number and facebook profile of a company and uses these inputs to match & return a single (best matching) company profile.

The goal of this coding part is to come up with a matching algorithm that will help you achieve a high match rate against your stored company profiles.

Note: the match rate is the number of entries you are able to match and return from the available 1000 company profiles that you put together in the previous step.


To test your API, please use this input sample: API-input-sample.csv

3. Bonus points – no coding required
Think of a way of measuring the accuracy of your matches. The match accuracy refers to how well the provided input matches the returned entry.

Guidelines
Make sure to pay extra attention to the format and quality of the datapoints that go into your company profiles, as how you collect, model and query your data plays a crucial role in how your API will perform.
Explore this from as many different angles as you can. It will generate valuable questions.
From a tech stack perspective, you can use any programming language, toolset or libraries you’re comfortable with or find necessary, especially if you know it would be a better option or a more interesting one (we generally prefer Node, Python, Java).
At Veridion, we run similar solutions on billions of records. While your project doesn’t need to scale to that level, it would be impressive if it does.
Expected Deliverables
Solution explanation / presentation
Provide an explanation or presentation of your solution and results. You have total creative freedom here—feel free to impress with your thinking process, the paths you took or decided not to take, the reasoning behind your decisions and what led to your approach.

Output
Your program should output the API that returns data about a company based on the above.

Code and Logic
Include the code that enabled you to achieve this.

Submit your project
When you’re finished with the challenge, please submit the link to your Github project below.